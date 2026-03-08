import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/database';
import { awardCredits } from './creditController';

type PlanId = 'monthly' | 'yearly';
type PaymentStatus = 'pending' | 'approved' | 'declined' | 'voided' | 'error';

interface WompiSignature {
  checksum?: string;
  properties?: string[];
}

interface WompiWebhookBody {
  event?: string;
  data?: {
    transaction?: {
      id?: string;
      status?: string;
      amount_in_cents?: number;
      reference?: string;
    };
  };
  signature?: WompiSignature;
}

const PLANS: Record<PlanId, { amountInCents: number; durationDays: number; label: string }> = {
  monthly: {
    amountInCents: 490000,
    durationDays: 30,
    label: 'mensual',
  },
  yearly: {
    amountInCents: 3990000,
    durationDays: 365,
    label: 'anual',
  },
};

const getWompiBaseUrl = (): string =>
  process.env.NODE_ENV === 'production'
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1';

const mapWompiStatusToInternal = (status?: string): PaymentStatus => {
  switch ((status ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved';
    case 'DECLINED':
      return 'declined';
    case 'VOIDED':
      return 'voided';
    case 'ERROR':
      return 'error';
    default:
      return 'pending';
  }
};

const getValueByPath = (obj: unknown, path: string): string => {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in acc) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);

  return value === undefined || value === null ? '' : String(value);
};

const verifyWebhookSignature = (body: WompiWebhookBody): boolean => {
  const eventSecret = process.env.WOMPI_EVENT_SECRET;
  const signature = body.signature;

  if (!eventSecret || !signature?.checksum || !Array.isArray(signature.properties)) {
    return false;
  }

  const payload = signature.properties
    .map((propertyPath) => getValueByPath(body, propertyPath))
    .join('');

  const computed = crypto
    .createHash('sha256')
    .update(payload + eventSecret)
    .digest('hex');

  return computed.toLowerCase() === signature.checksum.toLowerCase();
};

export const getPlans = async (_req: Request, res: Response): Promise<void> => {
  res.json({
    plans: [
      {
        id: 'monthly',
        name: 'Mensual',
        price_cop: 4900,
        duration_days: 30,
        features: ['Sin anuncios', 'Alertas de bajada gratis', 'Acceso prioritario'],
      },
      {
        id: 'yearly',
        name: 'Anual',
        price_cop: 39900,
        duration_days: 365,
        features: ['Todo lo de Mensual', '2 meses gratis', 'Soporte prioritario'],
      },
    ],
  });
};

export const createCheckout = async (req: Request, res: Response): Promise<void> => {
  const { plan } = req.body as { plan?: PlanId };
  const userId = (req as Request & { userId?: number }).userId;

  if (!plan || !Object.prototype.hasOwnProperty.call(PLANS, plan)) {
    res.status(400).json({ message: 'Plan inválido' });
    return;
  }

  if (!userId) {
    res.status(401).json({ message: 'No tienes autorización' });
    return;
  }

  const wompiPublicKey = process.env.WOMPI_PUBLIC_KEY;
  const wompiPrivateKey = process.env.WOMPI_PRIVATE_KEY;
  const appUrl = process.env.APP_URL;

  if (!wompiPublicKey || !wompiPrivateKey || !appUrl) {
    res.status(500).json({ message: 'Configuración de pagos incompleta' });
    return;
  }

  const selectedPlan = PLANS[plan];
  const wompiBaseUrl = getWompiBaseUrl();
  const reference = `mibus-${userId}-${plan}-${Date.now()}`;

  try {
    const merchantResponse = await axios.get(`${wompiBaseUrl}/merchants/${wompiPublicKey}`);
    const acceptanceToken = merchantResponse?.data?.data?.presigned_acceptance?.acceptance_token as
      | string
      | undefined;

    if (!acceptanceToken) {
      throw new Error('No se obtuvo acceptance token de Wompi');
    }

    const paymentLinkResponse = await axios.post(
      `${wompiBaseUrl}/payment_links`,
      {
        name: `MiBus Premium - ${plan}`,
        description: `Suscripción ${selectedPlan.label} MiBus`,
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: selectedPlan.amountInCents,
        redirect_url: `${appUrl}/payment/result`,
        reference,
        acceptance_token: acceptanceToken,
      },
      {
        headers: {
          Authorization: `Bearer ${wompiPrivateKey}`,
        },
      }
    );

    const paymentLinkData = paymentLinkResponse?.data?.data as { id?: string; url?: string } | undefined;

    await pool.query(
      `INSERT INTO payments (user_id, wompi_reference, plan, amount_cents, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [userId, reference, plan, selectedPlan.amountInCents]
    );

    res.json({
      checkout_url: paymentLinkData?.url ?? `https://checkout.wompi.co/l/${paymentLinkData?.id ?? ''}`,
    });
  } catch (error) {
    console.error('Error creando checkout en Wompi:', error);
    res.status(500).json({ message: 'No se pudo iniciar el checkout' });
  }
};

export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as WompiWebhookBody;

  if (!verifyWebhookSignature(body)) {
    res.status(401).json({ message: 'Firma inválida' });
    return;
  }

  if (body.event !== 'transaction.updated') {
    res.status(200).json({ received: true });
    return;
  }

  const transaction = body.data?.transaction;
  const reference = transaction?.reference;
  const transactionStatus = transaction?.status ?? '';
  const transactionId = transaction?.id ?? null;

  if (!reference) {
    res.status(200).json({ received: true });
    return;
  }

  const client = await pool.connect();
  let approvedUserId: number | null = null;
  let approvedPlan: PlanId | null = null;

  try {
    await client.query('BEGIN');

    const paymentResult = await client.query(
      `SELECT id, user_id, plan, status
       FROM payments
       WHERE wompi_reference = $1
       FOR UPDATE`,
      [reference]
    );

    if (paymentResult.rows.length === 0) {
      await client.query('COMMIT');
      res.status(200).json({ received: true });
      return;
    }

    const payment = paymentResult.rows[0] as {
      id: number;
      user_id: number | null;
      plan: PlanId;
      status: PaymentStatus;
    };

    if (payment.status === 'approved') {
      await client.query('COMMIT');
      res.status(200).json({ received: true });
      return;
    }

    const internalStatus = mapWompiStatusToInternal(transactionStatus);

    await client.query(
      `UPDATE payments
       SET status = $1, wompi_transaction_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [internalStatus, transactionId, payment.id]
    );

    if (transactionStatus.toUpperCase() === 'APPROVED' && payment.user_id) {
      const durationDays = PLANS[payment.plan].durationDays;

      await client.query(
        `UPDATE users
         SET is_premium = true,
             role = 'premium',
             premium_expires_at = CASE
               WHEN premium_expires_at IS NOT NULL AND premium_expires_at > NOW()
                 THEN premium_expires_at + ($2 || ' days')::interval
               ELSE NOW() + ($2 || ' days')::interval
             END
         WHERE id = $1`,
        [payment.user_id, durationDays]
      );

      approvedUserId = payment.user_id;
      approvedPlan = payment.plan;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error procesando webhook de Wompi:', error);
  } finally {
    client.release();
  }

  if (approvedUserId && approvedPlan) {
    try {
      await awardCredits(approvedUserId, 50, 'earn', 'Bono por activar Premium');
    } catch (error) {
      console.error('Error otorgando bono premium:', error);
    }
  }

  res.status(200).json({ received: true });
};

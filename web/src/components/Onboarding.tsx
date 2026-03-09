import { useMemo, useState } from 'react';

interface Props {
  open: boolean;
  onFinish: () => void;
}

const STEPS = [
  '🚌 Tú eres el GPS — Cuando subes a un bus y lo compartes, todos saben dónde está',
  '📍 Planea tu viaje — Escribe tu destino y te mostramos qué bus tomar y dónde abordarlo',
  '⚡ Gana créditos — Cada minuto que transmites = +1 crédito. Reportar un trancón = +3 créditos',
  '🎁 Tienes 50 créditos de bienvenida y 14 días Premium gratis — ¡Empieza!',
];

export default function Onboarding({ open, onFinish }: Props) {
  const [step, setStep] = useState(0);
  const total = STEPS.length;
  const isLast = step === total - 1;

  const title = useMemo(() => `Paso ${step + 1} de ${total}`, [step, total]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[1300] bg-black/50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <p className="text-xs uppercase tracking-wide font-semibold text-blue-600 mb-2">{title}</p>
        <p className="text-base text-gray-900 leading-relaxed min-h-[96px]">
          {STEPS[step]}
        </p>

        <div className="flex gap-1.5 my-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-blue-600' : 'bg-gray-200'}`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => (step === 0 ? onFinish() : setStep((s) => s - 1))}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            {step === 0 ? 'Omitir' : 'Atrás'}
          </button>

          <button
            type="button"
            onClick={() => (isLast ? onFinish() : setStep((s) => s + 1))}
            className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            {isLast ? 'Empezar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}

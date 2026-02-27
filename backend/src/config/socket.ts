import { Server } from 'socket.io';

let io: Server;

export const setIo = (server: Server): void => {
  io = server;
};

export const getIo = (): Server => io;

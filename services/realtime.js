let ioInstance = null;

export const setRealtime = (io) => {
  ioInstance = io;
};

export const getRealtime = () => ioInstance;




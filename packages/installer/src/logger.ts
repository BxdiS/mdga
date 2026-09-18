export const logger = {
  info(msg: string): void {
    console.log(`[mdga] ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`[mdga] warn: ${msg}`);
  },
  error(msg: string): void {
    console.error(`[mdga] error: ${msg}`);
  },
};

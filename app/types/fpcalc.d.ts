declare module "fpcalc" {
  interface FpcalcResult {
    fingerprint: string;
    duration: number;
  }

  interface FpcalcOptions {
    length?: number;
    raw?: boolean;
  }

  function fpcalc(
    filePath: string,
    options: FpcalcOptions,
    callback: (err: Error | null, result: FpcalcResult) => void,
  ): void;

  export default fpcalc;
}

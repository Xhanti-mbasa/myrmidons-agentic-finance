declare module "better-sqlite3" {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement<BindParameters extends any[] = any[], Result = any> {
    run(...params: BindParameters): RunResult;
    get(...params: BindParameters): Result | undefined;
    all(...params: BindParameters): Result[];
    iterate(...params: BindParameters): IterableIterator<Result>;
  }

  export interface Transaction<F extends (...args: any[]) => any = (...args: any[]) => any> {
    (...args: Parameters<F>): ReturnType<F>;
    default(...args: Parameters<F>): ReturnType<F>;
    deferred(...args: Parameters<F>): ReturnType<F>;
    immediate(...args: Parameters<F>): ReturnType<F>;
    exclusive(...args: Parameters<F>): ReturnType<F>;
  }

  export interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: any, ...additionalArgs: any[]) => void;
    nativeBinding?: string;
  }

  export interface Database {
    memory: boolean;
    readonly: boolean;
    name: string;
    open: boolean;
    inTransaction: boolean;

    prepare<BindParameters extends any[] = any[], Result = any>(
      source: string
    ): Statement<BindParameters, Result>;
    transaction<F extends (...args: any[]) => any>(fn: F): Transaction<F>;
    exec(source: string): this;
    pragma(source: string, options?: { simple?: boolean }): any;
    close(): this;
    defaultSafeIntegers(toggleState?: boolean): this;
  }

  export default function Database(
    filename?: string | Buffer,
    options?: DatabaseOptions
  ): Database;
}

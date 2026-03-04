/**
 * Phase U: Performance Engine - Parallel Runner
 * 
 * Concurrency-limited parallel execution for detector families.
 * Maintains determinism through stable ordering.
 */

export interface ParallelOptions {
  concurrency: number;
  timeoutMs?: number;
}

export interface TaskResult<T> {
  index: number;
  result?: T;
  error?: Error;
  durationMs: number;
}

/**
 * Run tasks in parallel with concurrency limit
 * 
 * Unlike Promise.all, this:
 * - Limits concurrent executions
 * - Preserves order in results
 * - Captures timing per task
 * - Handles errors gracefully
 */
export async function runParallel<T>(
  tasks: Array<() => Promise<T>>,
  options: ParallelOptions
): Promise<TaskResult<T>[]> {
  const { concurrency, timeoutMs = 30000 } = options;
  
  const results: TaskResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;
  
  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIndex++;
      if (idx >= tasks.length) break;
      
      const start = Date.now();
      
      try {
        const result = await Promise.race([
          tasks[idx](),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
          )
        ]);
        
        results[idx] = {
          index: idx,
          result,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        results[idx] = {
          index: idx,
          error: error as Error,
          durationMs: Date.now() - start,
        };
      }
    }
  }
  
  // Spawn workers
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker()
  );
  
  await Promise.all(workers);
  
  return results;
}

/**
 * Run tasks in parallel, collecting only successful results
 */
export async function runParallelCollect<T>(
  tasks: Array<() => Promise<T[]>>,
  options: ParallelOptions
): Promise<{ results: T[]; errors: Error[]; timings: number[] }> {
  const taskResults = await runParallel(tasks, options);
  
  const results: T[] = [];
  const errors: Error[] = [];
  const timings: number[] = [];
  
  for (const tr of taskResults) {
    timings.push(tr.durationMs);
    
    if (tr.error) {
      errors.push(tr.error);
    } else if (tr.result) {
      results.push(...tr.result);
    }
  }
  
  return { results, errors, timings };
}

/**
 * Batch items into chunks for parallel processing
 */
export function batchItems<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  return batches;
}

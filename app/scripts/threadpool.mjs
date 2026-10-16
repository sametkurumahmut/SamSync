// Same as src/main/threadpool.ts, for the web preview: imported before anything touches a file.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '32';

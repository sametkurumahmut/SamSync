// Node runs file operations on a pool of 4 threads unless told otherwise. A send keeps many files in
// flight on several machines at once, and on a share each operation waits for the network, so a bigger
// pool lets them overlap. The size is read when the pool first starts, so this must run before any
// file operation: it is the first import of the main entry.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '32';

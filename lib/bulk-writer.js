export function createBulkWriterQueue(db) {
  const writer = db.bulkWriter();
  let firstError = null;
  let writes = 0;
  let closePromise = null;

  function add(writePromise, onSuccess) {
    Promise.resolve(writePromise).then(
      () => {
        try {
          onSuccess?.();
          writes += 1;
        } catch (err) {
          firstError ??= err;
        }
      },
      (err) => {
        firstError ??= err;
      }
    );
  }

  function close() {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      await writer.close();

      if (firstError) throw firstError;
    })();

    return closePromise;
  }

  return {
    writer,
    add,
    close,
    get writes() {
      return writes;
    },
  };
}

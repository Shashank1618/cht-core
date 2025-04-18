import logger from '@medic/logger';
import { Nullable, Page } from '../../libs/core';
import { Doc, isDoc } from '../../libs/doc';

/** @internal */
export const getDocById = (db: PouchDB.Database<Doc>) => async (uuid: string): Promise<Nullable<Doc>> => db
  .get(uuid)
  .then(doc => isDoc(doc) ? doc : null)
  .catch((err: unknown) => {
    if ((err as PouchDB.Core.Error).status === 404) {
      return null;
    }

    logger.error(`Failed to fetch doc with id [${uuid}]`, err);
    throw err;
  });

/** @internal */
export const getDocsByIds = (db: PouchDB.Database<Doc>) => async (uuids: string[]): Promise<Doc[]> => {
  const keys = Array.from(new Set(uuids.filter(uuid => uuid.length)));
  if (!keys.length) {
    return [];
  }
  const response = await db.allDocs({ keys, include_docs: true });
  return response.rows
    .map(({ doc }) => doc)
    .filter((doc): doc is Doc => isDoc(doc));
};

const queryDocs = (
  db: PouchDB.Database<Doc>,
  view: string,
  options: PouchDB.Query.Options<Doc, Record<string, unknown>>
) => db
  .query(view, options)
  .then(({ rows }) => rows.map(({ doc }) => isDoc(doc) ? doc : null));

/** @internal */
export const queryDocsByRange = (
  db: PouchDB.Database<Doc>,
  view: string
) => async (
  startkey: unknown,
  endkey: unknown,
  limit?: number,
  skip = 0
): Promise<Nullable<Doc>[]> => queryDocs(
  db,
  view,
  {
    include_docs: true,
    startkey,
    endkey,
    limit,
    skip,
  }
);

/** @internal */
export const queryDocsByKey = (
  db: PouchDB.Database<Doc>,
  view: string
) => async (
  key: unknown,
  limit: number,
  skip: number
): Promise<Nullable<Doc>[]> => queryDocs(db, view, { include_docs: true, key, limit, skip });

const queryDocUuids = (
  db: PouchDB.Database<Doc>,
  view: string,
  options: PouchDB.Query.Options<Doc, Record<string, unknown>>
) => db
  .query(view, options)
  .then(({ rows }) => rows.map(({ id }) => id as string));

/** @internal */
export const queryDocUuidsByRange = (
  db: PouchDB.Database<Doc>,
  view: string
) => async (
  startkey: unknown,
  endkey: unknown,
  limit?: number,
  skip = 0
): Promise<string[]> => queryDocUuids(
  db,
  view,
  {
    include_docs: false,
    startkey,
    endkey,
    limit,
    skip,
  }
);

/** @internal */
export const queryDocUuidsByKey = (
  db: PouchDB.Database<Doc>,
  view: string
) => async (
  key: unknown,
  limit: number,
  skip: number
): Promise<string[]> => queryDocUuids(db, view, { include_docs: false, key, limit, skip });

/**
 * Resolves a page containing an array of T using the getFunction to retrieve documents from the database
 * and the filterFunction to validate the returned documents are all of type T.
 * The length of the page's data array is guaranteed to equal limit unless there is no more data to retrieve
 * from the database. This function will try to minimize the number of getFunction calls required to find
 * the necessary data by over-fetching during followup calls if some retrieved docs are rejected by the filterFunction.
 * @internal
 */
export const fetchAndFilter = <T>(
  getFunction: (limit: number, skip: number) => Promise<Nullable<T>[]>,
  filterFunction: (doc: Nullable<T>, uuid?: string) => boolean,
  limit: number,
): typeof recursionInner => {
  const recursionInner = async (
    currentLimit: number,
    currentSkip: number,
    currentDocs: T[] = [],
  ): Promise<Page<T>> => {
    const docs = await getFunction(currentLimit, currentSkip);
    const noMoreResults = docs.length < currentLimit;
    const newDocs = docs.filter((doc): doc is T => filterFunction(doc));
    const overFetchCount = currentDocs.length + newDocs.length - limit || 0;
    const totalDocs = [...currentDocs, ...newDocs].slice(0, limit);

    if (noMoreResults) {
      return {data: totalDocs, cursor: null};
    }

    if (totalDocs.length === limit) {
      const nextSkip = currentSkip + currentLimit - overFetchCount;

      return {data: totalDocs, cursor: nextSkip.toString()};
    }

    // Re-fetch twice as many docs as we need to limit number of recursions
    const missingCount = currentLimit - newDocs.length;
    logger.debug(`Found [${missingCount.toString()}] invalid docs. Re-fetching additional records.`);
    const nextLimit = missingCount * 2;
    const nextSkip = currentSkip + currentLimit;

    return recursionInner(
      nextLimit,
      nextSkip,
      totalDocs,
    );
  };
  return recursionInner;
};

/** @internal */
export const fetchAndFilterUuids = (
  getFunction: (limit: number, skip: number) => Promise<string[]>,
  limit: number,
): ReturnType<typeof fetchAndFilter<string>> => {
  const uuidSet = new Set<string>();
  const filterFn = (uuid: Nullable<string>): boolean => {
    if (!uuid) {
      return false;
    }
    const { size } = uuidSet;
    uuidSet.add(uuid);
    return uuidSet.size !== size;
  };

  return fetchAndFilter(
    getFunction,
    filterFn,
    limit
  );
};

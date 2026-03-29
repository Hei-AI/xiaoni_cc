const { createTrafficPersistence } = require('../../../../../packages/persistence/traffic');
const { serializeTimestampForStorage } = require('../../../../../packages/persistence/time');

type SqlFragment = {
  text: string;
  values: unknown[];
};

function isSqlFragment(value: unknown): value is SqlFragment {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as SqlFragment).text === 'string'
    && Array.isArray((value as SqlFragment).values)
  );
}

function renumberPlaceholders(text: string, offset: number): string {
  return text.replace(/\$(\d+)/g, (_match: string, value: string) => `$${Number(value) + offset}`);
}

function appendFragment(target: SqlFragment, fragment: SqlFragment): SqlFragment {
  if (!fragment.text) {
    return target;
  }

  return {
    text: `${target.text}${renumberPlaceholders(fragment.text, target.values.length)}`,
    values: [...target.values, ...fragment.values]
  };
}

function createSqlFragment(text: string): SqlFragment {
  return { text, values: [] };
}

function createFakePrisma() {
  return {
    empty: createSqlFragment(''),
    join(items: unknown[], separator: string | SqlFragment = ', '): SqlFragment {
      const separatorFragment = typeof separator === 'string' ? createSqlFragment(separator) : separator;
      return items.reduce<SqlFragment>((accumulator, item, index) => {
        if (index > 0) {
          accumulator = appendFragment(accumulator, separatorFragment);
        }

        return appendFragment(
          accumulator,
          isSqlFragment(item) ? item : createSqlFragment(String(item))
        );
      }, createSqlFragment(''));
    },
    sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
      return strings.reduce<SqlFragment>((accumulator, chunk, index) => {
        let next = accumulator.text ? appendFragment(accumulator, createSqlFragment(chunk)) : createSqlFragment(chunk);

        if (index >= values.length) {
          return next;
        }

        const value = values[index];
        if (isSqlFragment(value)) {
          return appendFragment(next, value);
        }

        return {
          text: `${next.text}$${next.values.length + 1}`,
          values: [...next.values, value]
        };
      }, createSqlFragment(''));
    }
  };
}

describe('traffic persistence time filters', () => {
  it('casts custom time filters to timestamp in raw traffic queries', async () => {
    const Prisma = createFakePrisma();
    const recordedQueries: SqlFragment[] = [];
    const prismaClient = {
      $queryRaw: jest.fn(async (query: SqlFragment) => {
        recordedQueries.push({
          text: query.text.replace(/\s+/g, ' ').trim(),
          values: query.values
        });

        return recordedQueries.length === 1 ? [] : [{ total: 0n }];
      })
    };

    const persistence = createTrafficPersistence({
      getPrismaClient: () => prismaClient,
      Prisma
    });

    await persistence.listTrafficLogs({
      page: 1,
      limit: 20,
      filters: {
        startTime: '2026-03-28T04:00:00.000Z',
        endTime: '2026-03-28T05:00:00.000Z'
      }
    });

    expect(prismaClient.$queryRaw).toHaveBeenCalledTimes(2);
    expect(recordedQueries[0]?.text).toContain('request_timestamp >= CAST($1 AS timestamp)');
    expect(recordedQueries[0]?.text).toContain('request_timestamp <= CAST($2 AS timestamp)');
    expect(recordedQueries[0]?.values).toEqual([
      serializeTimestampForStorage(new Date('2026-03-28T04:00:00.000Z')),
      serializeTimestampForStorage(new Date('2026-03-28T05:00:00.000Z')),
      20,
      0
    ]);
    expect(recordedQueries[1]?.text).toContain('request_timestamp >= CAST($1 AS timestamp)');
    expect(recordedQueries[1]?.text).toContain('request_timestamp <= CAST($2 AS timestamp)');
    expect(recordedQueries[1]?.values).toEqual([
      serializeTimestampForStorage(new Date('2026-03-28T04:00:00.000Z')),
      serializeTimestampForStorage(new Date('2026-03-28T05:00:00.000Z'))
    ]);
  });
});

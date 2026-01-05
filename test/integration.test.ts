import { createClient, gql, fetchExchange } from 'urql';
import { tinyBaseExchange } from '../src/index';
// Simple store mock instead of importing from elsewhere
import { createStore, createIndexes, createMetrics, createQueries } from 'tinybase';
import { buildSchema, execute, parse } from 'graphql';

const createTestStore = () => createStore();

// Mock server setup
const schema = buildSchema(`
  directive @dbMergeRow(table: String!) on FIELD
  directive @dbDeleteRow(table: String!) on FIELD

  type User {
    id: ID!
    name: String!
    createdAt: String
  }
  type Query {
    user(id: ID!): User
    users: [User!]!
  }
  type Mutation {
    createUser(id: ID!, name: String!, createdAt: String): User
    deleteUser(id: ID!): ID
    updateUser(id: ID!, name: String!): User
  }
`);

const rootValue = {
    user: ({ id }: any) => ({ id, name: `User ${id}` }),
    users: () => [{ id: '1', name: 'User 1' }, { id: '2', name: 'User 2' }],
    createUser: ({ id, name, createdAt }: any) => ({ id, name, createdAt }),
    deleteUser: ({ id }: any) => id,
    updateUser: ({ id, name }: any) => ({ id, name }),
};

describe('tinyBaseExchange', () => {
    let store: any;
    let client: any;

    beforeEach(() => {
        store = createTestStore();
        client = createClient({
            url: 'http://localhost:4000/graphql',
            exchanges: [
                tinyBaseExchange({ store }),
                fetchExchange,
            ],
            fetch: async (_input: any, init: any) => {
                // Mock fetch by executing directly against schema
                const body = JSON.parse(init.body);
                const result = await execute({
                    schema,
                    document: parse(body.query),
                    rootValue,
                    variableValues: body.variables
                });

                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (key: string) => (key === 'Content-Type' ? 'application/json' : null),
                    },
                    json: async () => ({ data: result.data, errors: result.errors }),
                    text: async () => JSON.stringify({ data: result.data, errors: result.errors })
                } as any;
            }
        });
    });

    it('should add a row on @dbMergeRow', async () => {
        const mutation = gql`
      mutation {
        createUser(id: "1", name: "Alice") @dbMergeRow(table: "users") {
          id
          name
        }
      }
    `;

        await client.mutation(mutation).toPromise();

        expect(store.hasRow('users', '1')).toBe(true);
        expect(store.getRow('users', '1')).toEqual({ id: '1', name: 'Alice' });
    });

    it('should update a row on @dbMergeRow', async () => {
        store.setRow('users', '1', { id: '1', name: 'Alice' });

        const mutation = gql`
      mutation {
        updateUser(id: "1", name: "Alice Updated") @dbMergeRow(table: "users") {
          id
          name
        }
      }
    `;

        await client.mutation(mutation).toPromise();

        expect(store.getRow('users', '1')).toEqual({ id: '1', name: 'Alice Updated' });
    });

    it('should delete a row on @dbDeleteRow', async () => {
        store.setRow('users', '1', { id: '1', name: 'Alice' });

        const mutation = gql`
       mutation {
         deleteUser(id: "1") @dbDeleteRow(table: "users")
       }
     `;

        await client.mutation(mutation).toPromise();

        expect(store.hasRow('users', '1')).toBe(false);
    });

    describe('Advanced Features: Indexes, Metrics, Queries', () => {
        it('should update indexes when data changes via exchange', async () => {
            const indexes = createIndexes(store);
            indexes.setIndexDefinition('byName', 'users', 'name');

            const mutation = gql`
                mutation {
                    createUser(id: "1", name: "Alice") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                    createUser2: createUser(id: "2", name: "Bob") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                }
            `;

            await client.mutation(mutation).toPromise();

            expect(indexes.getSliceRowIds('byName', 'Alice')).toEqual(['1']);
            expect(indexes.getSliceRowIds('byName', 'Bob')).toEqual(['2']);
        });

        it('should update metrics when data changes via exchange', async () => {
            const metrics = createMetrics(store);
            metrics.setMetricDefinition('totalUsers', 'users', 'sum', () => 1);

            const mutation = gql`
                mutation {
                    createUser(id: "1", name: "Alice") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                    createUser2: createUser(id: "2", name: "Bob") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                }
            `;

            await client.mutation(mutation).toPromise();

            expect(metrics.getMetric('totalUsers')).toBe(2);
        });

        it('should update queries when data changes via exchange', async () => {
            const queries = createQueries(store);
            queries.setQueryDefinition('usersNamedAlice', 'users', ({ select, where }) => {
                select('id');
                where('name', 'Alice');
            });

            const mutation = gql`
                mutation {
                    createUser(id: "1", name: "Alice") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                    createUser2: createUser(id: "2", name: "Bob") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                }
            `;

            await client.mutation(mutation).toPromise();

            expect(queries.getResultRowIds('usersNamedAlice')).toEqual(['1']);
        });

        it('should return sorted results when querying with sort order', async () => {
            const queries = createQueries(store);
            // Query all users
            queries.setQueryDefinition('allUsers', 'users', ({ select }) => {
                select('id');
                select('name');
            });

            const mutation = gql`
            mutation {
                u1: createUser(id: "1", name: "Charlie") @dbMergeRow(table: "users") { id name }
                u2: createUser(id: "2", name: "Alice") @dbMergeRow(table: "users") { id name }
                u3: createUser(id: "3", name: "Bob") @dbMergeRow(table: "users") { id name }
            }
        `;

            await client.mutation(mutation).toPromise();

            // Sort by name ASC
            expect(queries.getResultSortedRowIds('allUsers', 'name')).toEqual(['2', '3', '1']); // Alice (2), Bob (3), Charlie (1)

            // Sort by name DESC
            expect(queries.getResultSortedRowIds('allUsers', 'name', true)).toEqual(['1', '3', '2']); // Charlie (1), Bob (3), Alice (2)
        });

        it('should return sorted results when querying by date', async () => {
            const queries = createQueries(store);
            queries.setQueryDefinition('usersByDate', 'users', ({ select }) => {
                select('id');
                select('createdAt');
            });

            const mutation = gql`
            mutation {
                u1: createUser(id: "1", name: "Oldest", createdAt: "2023-01-01") @dbMergeRow(table: "users") { id name createdAt }
                u2: createUser(id: "2", name: "Newest", createdAt: "2024-01-01") @dbMergeRow(table: "users") { id name createdAt }
                u3: createUser(id: "3", name: "Middle", createdAt: "2023-06-01") @dbMergeRow(table: "users") { id name createdAt }
            }
        `;

            await client.mutation(mutation).toPromise();

            // Sort by createdAt ASC (Oldest first)
            expect(queries.getResultSortedRowIds('usersByDate', 'createdAt')).toEqual(['1', '3', '2']);

            // Sort by createdAt DESC (Newest first)
            expect(queries.getResultSortedRowIds('usersByDate', 'createdAt', true)).toEqual(['2', '3', '1']);
        });
    });
});

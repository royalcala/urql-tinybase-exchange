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

  type Reaction {
    id: ID!
    emoji: String!
    user: User!
  }

  type Comment {
    id: ID!
    text: String!
    author: User!
    reactions: [Reaction!]!
    replies: [Comment!]!
  }

  type Post {
    id: ID!
    title: String!
    comments: [Comment!]!
  }

  type User {
    id: ID!
    name: String!
    createdAt: String
  }
  type Query {
    user(id: ID!): User
    users: [User!]!
    post(id: ID!): Post
  }
  type Mutation {
    createUser(id: ID!, name: String!, createdAt: String): User
    deleteUser(id: ID!): ID
    updateUser(id: ID!, name: String!): User
    createPost(id: ID!, title: String!): Post
  }
`);

const rootValue = {
    user: ({ id }: any) => ({ id, name: `User ${id}` }),
    users: () => [{ id: '1', name: 'User 1' }, { id: '2', name: 'User 2' }],
    post: ({ id }: any) => ({
        id,
        title: `Post ${id}`,
        comments: [
            {
                id: 'c1',
                text: 'Comment 1',
                author: { id: 'u1', name: 'User 1' },
                reactions: [{ id: 'r1', emoji: '👍', user: { id: 'u2', name: 'User 2' } }],
                replies: [
                    {
                        id: 'c2',
                        text: 'Reply 1',
                        author: { id: 'u3', name: 'User 3' },
                        reactions: [],
                        replies: []
                    }
                ]
            }
        ]
    }),
    createUser: ({ id, name, createdAt }: any) => ({ id, name, createdAt }),
    deleteUser: ({ id }: any) => id,
    updateUser: ({ id, name }: any) => ({ id, name }),
    createPost: ({ id, title }: any) => ({
        id,
        title,
        comments: [
            {
                id: 'c100',
                text: 'New Comment',
                author: { id: 'u100', name: 'Author 100' },
                reactions: [{ id: 'r100', emoji: '🔥', user: { id: 'u101', name: 'Reactor 101' } }],
                replies: [
                    {
                        id: 'c101',
                        text: 'Nested Reply',
                        author: { id: 'u102', name: 'Replier 102' },
                        reactions: [],
                        replies: []
                    }
                ]
            }
        ]
    })
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

        it('should support @dbMergeRow inside dynamic fragments', async () => {
            const mutation = gql`
                fragment UserFields on User {
                    id
                    name
                }
                mutation {
                    createUser(id: "1", name: "Fragment User") @dbMergeRow(table: "users") {
                        ...UserFields
                    }
                }
            `;

            await client.mutation(mutation).toPromise();

            expect(store.getRow('users', '1')).toEqual({ id: '1', name: 'Fragment User' });
        });
        it('should support @dbMergeRow inside root fragments', async () => {
            const mutation = gql`
            fragment MutationFragment on Mutation {
                createUser(id: "99", name: "Fragment Root User") @dbMergeRow(table: "users") {
                    id
                    name
                }
            }
            mutation {
                ...MutationFragment
            }
        `;

            await client.mutation(mutation).toPromise();

            expect(store.getRow('users', '99')).toEqual({ id: '99', name: 'Fragment Root User' });
        });

        it('should support deeply nested fragments with recursion', async () => {
            const mutation = gql`
            fragment UserInfo on User {
                id
                name
            }

            fragment ReactionInfo on Reaction {
                id
                emoji
                user @dbMergeRow(table: "users") {
                    ...UserInfo
                }
            }

            fragment CommentInfo on Comment {
                id
                text
                author @dbMergeRow(table: "users") {
                    ...UserInfo
                }
                reactions @dbMergeRow(table: "reactions") {
                    ...ReactionInfo
                }
                replies @dbMergeRow(table: "comments") {
                    ...CommentInfo
                }
            }

            fragment PostInfo on Post {
                id
                title
                comments @dbMergeRow(table: "comments") {
                    ...CommentInfo
                }
            }

            mutation {
                createPost(id: "p1", title: "Complex Post") @dbMergeRow(table: "posts") {
                    ...PostInfo
                }
            }
        `;

            await client.mutation(mutation).toPromise();

            // Verify Post
            expect(store.getRow('posts', 'p1')).toEqual({ id: 'p1', title: 'Complex Post' });

            // Verify Top-level Comment
            expect(store.getRow('comments', 'c100')).toMatchObject({ id: 'c100', text: 'New Comment' });

            // Verify Nested Reply
            expect(store.getRow('comments', 'c101')).toMatchObject({ id: 'c101', text: 'Nested Reply' });

            // Verify Author of Comment
            expect(store.getRow('users', 'u100')).toEqual({ id: 'u100', name: 'Author 100' });

            // Verify Author of Reply
            expect(store.getRow('users', 'u102')).toEqual({ id: 'u102', name: 'Replier 102' });

            // Verify Reaction
            expect(store.getRow('reactions', 'r100')).toMatchObject({ id: 'r100', emoji: '🔥' });

            // Verify User of Reaction
            expect(store.getRow('users', 'u101')).toEqual({ id: 'u101', name: 'Reactor 101' });
        });

        it('should support partial updates (merge) without overwriting existing fields', async () => {
            // 1. Setup initial state with an "extra" field not in the GraphQL query
            store.setRow('users', 'partial-1', { id: 'partial-1', name: 'Original Name', extra: 'keep-me' });

            const mutation = gql`
                mutation {
                    updateUser(id: "partial-1", name: "Updated Name") @dbMergeRow(table: "users") {
                        id
                        name
                    }
                }
            `;

            await client.mutation(mutation).toPromise();

            // 2. Verify "name" is updated but "extra" is preserved
            expect(store.getRow('users', 'partial-1')).toEqual({
                id: 'partial-1',
                name: 'Updated Name',
                extra: 'keep-me'
            });

            // 3. Test adding a NEW field while keeping others
            const mutation2 = gql`
                mutation {
                    createUser(id: "partial-1", name: "Updated Name", createdAt: "2023-01-01") @dbMergeRow(table: "users") {
                        id
                        createdAt
                    }
                }
            `;

            await client.mutation(mutation2).toPromise();

            // 4. Verify "createdAt" is added, "name" (not in query) is preserved, "extra" is preserved
            expect(store.getRow('users', 'partial-1')).toEqual({
                id: 'partial-1',
                name: 'Updated Name',
                extra: 'keep-me',
                createdAt: '2023-01-01'
            });
        });
    });
});

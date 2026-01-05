/**
 * @jest-environment jsdom
 */
import { TextEncoder, TextDecoder } from 'util';

Object.assign(global, { TextEncoder, TextDecoder });

import React from 'react';
import { createClient, Provider as UrqlProvider, gql, useMutation, fetchExchange } from 'urql';
import { tinyBaseExchange } from '../src/index';
// @ts-ignore
import { createStore } from 'tinybase';
import { Provider, useCell, useCreateStore } from 'tinybase/ui-react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { buildSchema, execute, parse } from 'graphql';

// Mock server setup
const schema = buildSchema(`
  directive @dbMergeRow(table: String!) on FIELD

  type User {
    id: ID!
    name: String!
  }
  type Query {
    user(id: ID!): User
  }
  type Mutation {
    createUser(id: ID!, name: String!): User
  }
`);

const rootValue = {
    createUser: ({ id, name }: any) => ({ id, name }),
};

const TestComponent = () => {
    // Listen to data in TinyBase
    const userName = useCell('users', '1', 'name');

    // Urql mutation to trigger data fetch
    const [, createUser] = useMutation(gql`
    mutation {
      createUser(id: "1", name: "React Alice") @dbMergeRow(table: "users") {
        id
        name
      }
    }
  `);

    return (
        <div>
            <div data-testid="user-name">{userName || 'No User'}</div>
            <button data-testid="create-btn" onClick={() => createUser({})}>Create</button>
        </div>
    );
};

// Wrapper ensuring store exists
const Wrapper = () => {
    // We want to control the store instance to pass it to the exchange
    // But useCreateStore returns a new one if factory changes?
    // Let's create store once
    const store = React.useMemo(() => createStore(), []);

    // Create client ensuring it uses the SAME store instance
    const client = React.useMemo(() => createClient({
        url: 'http://localhost:4000/graphql',
        exchanges: [
            tinyBaseExchange({ store }),
            fetchExchange,
        ],
        fetch: async (_input: any, init: any) => {
            const body = JSON.parse(init.body as string);
            const result = await execute({
                schema,
                document: parse(body.query),
                rootValue,
                variableValues: body.variables
            });
            return {
                ok: true,
                status: 200,
                headers: { get: () => 'application/json' },
                json: async () => ({ data: result.data, errors: result.errors }),
                text: async () => JSON.stringify({ data: result.data, errors: result.errors })
            } as any;
        }
    }), [store]);

    return (
        <Provider store={store}>
            <UrqlProvider value={client}>
                <TestComponent />
            </UrqlProvider>
        </Provider>
    );
};

describe('React Integration', () => {
    it('should update component when exchange modifies store', async () => {
        render(<Wrapper />);

        expect(screen.getByTestId('user-name').textContent).toBe('No User');

        act(() => {
            screen.getByTestId('create-btn').click();
        });

        // useCell should trigger re-render with new value
        await waitFor(() => {
            expect(screen.getByTestId('user-name').textContent).toBe('React Alice');
        });
    });
});

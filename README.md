# urql-tinybase-exchange

A [Urql](https://urql.dev/) exchange for integrating with [TinyBase](https://tinybase.org/), allowing automatic persistence and synchronization of GraphQL data into a local reactive store.

## Features

- **Automatic Persistence**: Use the `@dbMergeRow` directive to automatically save mutation results to TinyBase.
- **Automatic Deletion**: Use the `@dbDeleteRow` directive to remove rows from TinyBase.
- **Reactive Queries**: Seamlessly integrates with TinyBase's reactive components (`useCell`, `useRow`, `useQuery`).
- **Advanced Support**: Fully compatible with TinyBase Indexes, Metrics, and Queries.

## Installation

```bash
npm install urql-tinybase-exchange urql tinybase graphql react
```

## Usage

### 1. Setup the Client

```typescript
import { createClient, fetchExchange } from 'urql';
import { createStore } from 'tinybase';
import { tinyBaseExchange } from 'urql-tinybase-exchange';

const store = createStore();

const client = createClient({
  url: 'http://localhost:4000/graphql',
  exchanges: [
    tinyBaseExchange({ store }),
    fetchExchange,
  ],
});
```

### 2. Use Directives in Mutations

**Merging Data (@dbMergeRow):**

```graphql
mutation CreateUser {
  createUser(id: "1", name: "Alice") @dbMergeRow(table: "users") {
    id
    name
  }
}
```

This will automatically do `store.setRow('users', '1', { id: '1', name: 'Alice' })`.

**Deleting Data (@dbDeleteRow):**

```graphql
mutation DeleteUser {
  deleteUser(id: "1") @dbDeleteRow(table: "users")
}
```

This will automatically do `store.delRow('users', '1')`.

### 3. React Integration

Since TinyBase is reactive, you can use standard hooks to listen to changes:

```tsx
import { useCell } from 'tinybase/ui-react';

const UserParams = ({ id }) => {
  const name = useCell('users', id, 'name');
  return <div>User: {name}</div>;
}
```

## License

MIT

# urql-tinybase-exchange

A [Urql](https://urql.dev/) exchange for integrating with [TinyBase](https://tinybase.org/), allowing automatic persistence and synchronization of GraphQL data into a local reactive store.

## Features

- **Automatic Persistence**: Use the `@dbMergeRow` directive to automatically save query and mutation results to TinyBase.
- **Automatic Deletion**: Use the `@dbDeleteRow` directive to remove rows from TinyBase.
- **Reactive Queries**: Seamlessly integrates with TinyBase's reactive components (`useCell`, `useRow`, `useQuery`).
- **Advanced Support**: Fully compatible with TinyBase Indexes, Metrics, and Queries.
- **Works with Queries and Mutations**: Sync data from both GraphQL queries and mutations.

## Installation

```bash
npm install urql-tinybase-exchange urql tinybase graphql react
```

## Usage

### 1. Setup the Client

```typescript
import { createClient, fetchExchange } from "urql";
import { createStore } from "tinybase";
import { tinyBaseExchange } from "urql-tinybase-exchange";

const store = createStore();

const client = createClient({
  url: "http://localhost:4000/graphql",
  exchanges: [tinyBaseExchange({ store }), fetchExchange],
});
```

### 2. Use Directives in Queries and Mutations

The `table` argument can be either a **string literal** or an **enum value**:

```graphql
# Define enum in your GraphQL schema (optional but recommended)
enum Table {
  Post
  Comment
  User
  Reaction
}

directive @dbMergeRow(table: Table!) on FIELD | FRAGMENT_DEFINITION
directive @dbDeleteRow(table: Table!) on FIELD

# Or use string literals
directive @dbMergeRow(table: String!) on FIELD | FRAGMENT_DEFINITION
directive @dbDeleteRow(table: String!) on FIELD
```

**Using with Queries (Enum or String):**

```graphql
# Using enum (Post will be converted to lowercase "post" for TinyBase table)
fragment PostFragment on Post @dbMergeRow(table: Post) {
  id
  title
  author @dbMergeRow(table: User) {
    id
    name
  }
}

# Or using string literal
fragment PostFragment on Post @dbMergeRow(table: "posts") {
  id
  title
  author @dbMergeRow(table: "users") {
    id
    name
  }
}

query GetPosts {
  posts {
    ...PostFragment
  }
}
```

This will automatically sync all posts and their authors to TinyBase when the query returns.

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
  deleteUser(id: "1") {
    id @dbDeleteRow(table: "users")
  }
}
```

This will automatically do `store.delRow('users', '1')`. The directive is applied to the `id` field which contains the row ID to delete.

### 3. React Integration

To use TinyBase hooks like `useCell`, `useRow`, or `useQuery`, you must wrap your app with the `Provider` from `tinybase/ui-react` and pass the **same store instance** you used for the exchange.

```tsx
import React from "react";
import { createClient, Provider as UrqlProvider, fetchExchange } from "urql";
import { createStore } from "tinybase";
import { Provider as TinyBaseProvider, useCell } from "tinybase/ui-react";
import { tinyBaseExchange } from "urql-tinybase-exchange";

// 1. Create the store
const store = createStore();

// 2. Create the client with the exchange using the SAME store
const client = createClient({
  url: "http://localhost:4000/graphql",
  exchanges: [tinyBaseExchange({ store }), fetchExchange],
});

const UserProfile = ({ id }) => {
  // 4. Use standard TinyBase hooks
  const name = useCell("users", id, "name");
  return <div>User: {name}</div>;
};

export const App = () => (
  // 3. Wrap your app with BOTH providers
  <TinyBaseProvider store={store}>
    <UrqlProvider value={client}>
      <UserProfile id="1" />
    </UrqlProvider>
  </TinyBaseProvider>
);
```

Since TinyBase is reactive, standard hooks will automatically trigger updates when the exchange modifies the store:

```tsx
import { useCell } from "tinybase/ui-react";

const UserParams = ({ id }) => {
  const name = useCell("users", id, "name");
  return <div>User: {name}</div>;
};
```

## License

MIT

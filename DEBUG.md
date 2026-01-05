# Debugging Guide

If your TinyBase store is empty after using the directives, check these common issues:

## 1. Table Name Can Be a String OR Enum

Both of these are valid:

✅ **Using Enum:**

```graphql
enum Table {
  Post
  Comment
  User
}

fragment PostFragment on Post @dbMergeRow(table: Post) {
  id
  title
}
```

✅ **Using String:**

```graphql
fragment PostFragment on Post @dbMergeRow(table: "posts") {
  id
  title
}
```

**Note:** When using enums, the value is automatically converted to lowercase for the TinyBase table name:

- `@dbMergeRow(table: Post)` → stores in table `"post"`
- `@dbMergeRow(table: "posts")` → stores in table `"posts"`

❌ **Wrong - Missing quotes for string:**

```graphql
fragment PostFragment on Post @dbMergeRow(table: posts) {
  # This won't work - "posts" needs quotes unless it's an enum
}
```

## 2. Data Must Have an `id` Field

The exchange uses the `id` field as the row key in TinyBase. Your GraphQL response MUST include an `id` field:

✅ **Correct:**

```graphql
fragment PostFragment on Post @dbMergeRow(table: "posts") {
  id # REQUIRED - used as the row key
  title
  content
}
```

**Warning message you'll see if missing:**

```
[TinyBase Exchange] Cannot merge data without 'id' field into table 'posts': { title: "..." }
```

## 3. Check Your Browser Console

The exchange now logs helpful errors and warnings to the console:

- **Errors**: Missing or invalid `table` argument
- **Warnings**: Missing `id` fields in data

Open your browser DevTools console and look for messages prefixed with `[TinyBase Exchange]`.

## 4. Check the Exchange is Processing Responses

Add temporary logging to verify the exchange is working:

```typescript
import { tinyBaseExchange } from "urql-tinybase-exchange";

const store = createStore();

// Add a listener to see when data changes
store.addTablesListener(() => {
  console.log("TinyBase updated:", store.getTablesJson());
});

const client = createClient({
  url: "http://localhost:4000/graphql",
  exchanges: [tinyBaseExchange({ store }), fetchExchange],
});
```

## 5. Verify the Query/Mutation Completes

Make sure you're waiting for the operation to complete:

```typescript
// ❌ Wrong - not waiting
client.query(MY_QUERY, {});
console.log(store.getTablesJson()); // Will be empty!

// ✅ Correct - await the promise
const result = await client.query(MY_QUERY, {}).toPromise();
console.log(store.getTablesJson()); // Should have data
```

## 6. Check for GraphQL Errors

```typescript
const result = await client.query(MY_QUERY, {}).toPromise();

if (result.error) {
  console.error("GraphQL Error:", result.error);
}

if (result.data) {
  console.log("Query succeeded, checking TinyBase...");
  console.log("Tables:", store.getTablesJson());
}
```

## 7. Verify Directives Are in Original Query

The exchange stores the original query before stripping directives. If you're building queries dynamically, ensure the directives are present in the AST.

## 8. Common Pitfalls

### Using Computed Fields

```graphql
fragment PostFragment on Post @dbMergeRow(table: "posts") {
  commentsWithReplies @computed(type: Post) {
    # ⚠️ Computed fields may not have IDs
    ...CommentFragment
  }
}
```

If `@computed` fields don't return objects with `id` fields, they won't be stored.

### Nested Fragments Without Directives

```graphql
fragment PostFragment on Post @dbMergeRow(table: "posts") {
  author {
    ...UserFragment # ⚠️ UserFragment needs @dbMergeRow too!
  }
}

fragment UserFragment on User @dbMergeRow(table: "users") {
  id
  name
}
```

Each nested object type needs its own `@dbMergeRow` directive if you want it stored separately.

## 9. Debug the Actual Issue

Create a minimal test case:

```typescript
import { createStore } from "tinybase";
import { createClient, gql, fetchExchange } from "urql";
import { tinyBaseExchange } from "urql-tinybase-exchange";

const store = createStore();
const client = createClient({
  url: "YOUR_GRAPHQL_URL",
  exchanges: [tinyBaseExchange({ store }), fetchExchange],
});

const TEST_QUERY = gql`
  query TestQuery {
    post(id: "1") @dbMergeRow(table: "posts") {
      id
      title
    }
  }
`;

async function test() {
  console.log("Before query:", store.getTablesJson());

  const result = await client.query(TEST_QUERY, {}).toPromise();

  console.log("GraphQL result:", result);
  console.log("After query:", store.getTablesJson());
  console.log("Has post?:", store.hasRow("posts", "1"));
  console.log("Post data:", store.getRow("posts", "1"));
}

test();
```

If this still doesn't work, please share:

1. The exact GraphQL query/fragment you're using
2. The response data structure
3. The console output from the debug script above

import { Exchange } from "urql";
import { pipe, tap, map } from "wonka";
import { Store } from "tinybase";
import { OperationDefinitionNode, visit } from "graphql";

export interface TinyBaseExchangeConfig {
  store: Store;
}

export const tinyBaseExchange = ({
  store,
}: TinyBaseExchangeConfig): Exchange => {
  return ({ forward }) =>
    (ops$) => {
      return pipe(
        ops$,
        map((operation) => {
          // Store the original query to process directives later
          const originalQuery = operation.query;

          // Strip @dbMergeRow and @dbDeleteRow directives from the query before sending to server
          const cleanedQuery = visit(operation.query, {
            Directive(node) {
              if (
                node.name.value === "dbMergeRow" ||
                node.name.value === "dbDeleteRow"
              ) {
                return null; // Remove the directive
              }
            },
          });

          return {
            ...operation,
            query: cleanedQuery,
            context: {
              ...operation.context,
              // Store original query in context so we can access it in the response
              __originalQuery: originalQuery,
            },
          };
        }),
        forward,
        tap((result) => {
          if (!result.data) return;

          const { operation } = result;
          // Use the original query (with directives) to process the response
          const query = operation.context.__originalQuery || operation.query;

          // Collect fragments
          const fragments: Record<string, any> = {};
          query.definitions.forEach((d: any) => {
            if (d.kind === "FragmentDefinition") {
              fragments[d.name.value] = d;
            }
          });

          // Helper to execute merge/delete logic for a given directive list and data
          const processDirectives = (directives: any, data: any) => {
            if (!directives) return;

            // Check for @dbMergeRow
            const mergeDirective = directives.find(
              (d: any) => d.name.value === "dbMergeRow"
            );
            if (mergeDirective) {
              const tableArg = mergeDirective.arguments?.find(
                (a: any) => a.name.value === "table"
              );

              if (!tableArg) {
                console.error(
                  "[TinyBase Exchange] @dbMergeRow directive is missing required 'table' argument"
                );
                return;
              }

              // Support both StringValue and EnumValue for table name
              let tableName: string;
              if (tableArg.value.kind === "StringValue") {
                tableName = tableArg.value.value;
              } else if (tableArg.value.kind === "EnumValue") {
                // Convert enum name to lowercase for table name (e.g., Post -> post)
                tableName = tableArg.value.value.toLowerCase();
              } else {
                console.error(
                  "[TinyBase Exchange] @dbMergeRow 'table' argument must be a string or enum. " +
                    `Got: ${tableArg.value.kind}`
                );
                return;
              }
              if (data && typeof data === "object") {
                if (Array.isArray(data)) {
                  data.forEach((row) => {
                    if (row.id) {
                      store.setPartialRow(tableName, row.id, { ...row });
                    } else {
                      console.warn(
                        `[TinyBase Exchange] Skipping row without 'id' field in table '${tableName}':`,
                        row
                      );
                    }
                  });
                } else if (data.id) {
                  store.setPartialRow(tableName, data.id, { ...data });
                } else {
                  console.warn(
                    `[TinyBase Exchange] Cannot merge data without 'id' field into table '${tableName}':`,
                    data
                  );
                }
              }
            }

            // Check for @dbDeleteRow (on field - the field value should be the ID)
            const deleteDirective = directives.find(
              (d: any) => d.name.value === "dbDeleteRow"
            );
            if (deleteDirective) {
              const tableArg = deleteDirective.arguments?.find(
                (a: any) => a.name.value === "table"
              );

              if (!tableArg) {
                console.error(
                  "[TinyBase Exchange] @dbDeleteRow directive is missing required 'table' argument"
                );
                return;
              }

              // Support both StringValue and EnumValue for table name
              let tableName: string;
              if (tableArg.value.kind === "StringValue") {
                tableName = tableArg.value.value;
              } else if (tableArg.value.kind === "EnumValue") {
                // Convert enum name to lowercase for table name (e.g., Post -> post)
                tableName = tableArg.value.value.toLowerCase();
              } else {
                console.error(
                  "[TinyBase Exchange] @dbDeleteRow 'table' argument must be a string or enum. " +
                    `Got: ${tableArg.value.kind}`
                );
                return;
              }
              if (data) {
                if (Array.isArray(data)) {
                  data.forEach((id) => {
                    store.delRow(tableName, String(id));
                  });
                } else {
                  store.delRow(tableName, String(data));
                }
              }
            }
          };

          // Helper to process selection sets recursively
          const processData = (
            data: any,
            selectionSet: any,
            parentType?: string
          ) => {
            if (!data || !selectionSet) return;

            // If data is an array, process each item
            if (Array.isArray(data)) {
              data.forEach((item) =>
                processData(item, selectionSet, parentType)
              );
              return;
            }

            if (typeof data === "object") {
              // Iterate over selections to find fields and directives
              selectionSet.selections.forEach((selection: any) => {
                if (selection.kind === "Field") {
                  const fieldName = selection.name.value;
                  const responseKey = selection.alias
                    ? selection.alias.value
                    : fieldName;
                  const fieldData = data[responseKey];

                  // Process directives on the field itself
                  processDirectives(selection.directives, fieldData);

                  // Recurse if the field has sub-selections
                  if (selection.selectionSet && fieldData) {
                    processData(fieldData, selection.selectionSet);
                  }
                } else if (selection.kind === "InlineFragment") {
                  if (selection.selectionSet) {
                    processData(data, selection.selectionSet);
                  }
                } else if (selection.kind === "FragmentSpread") {
                  const fragmentName = selection.name.value;
                  const fragment = fragments[fragmentName];
                  if (fragment) {
                    // Process directives on the fragment definition using current data context
                    processDirectives(fragment.directives, data);

                    if (fragment.selectionSet && data) {
                      processData(data, fragment.selectionSet);
                    }
                  }
                }
              });
            }
          };

          // We need to find the main operation definition
          const operationDef = query.definitions.find(
            (d: any) => d.kind === "OperationDefinition"
          ) as OperationDefinitionNode;

          if (operationDef && operationDef.selectionSet) {
            // Process each root field in the operation
            operationDef.selectionSet.selections.forEach((selection: any) => {
              if (selection.kind === "Field") {
                const fieldName = selection.name.value;
                const responseKey = selection.alias
                  ? selection.alias.value
                  : fieldName;
                const fieldData = result.data[responseKey];

                // Process directives on the root field
                processDirectives(selection.directives, fieldData);

                // Process the field's selection set
                if (selection.selectionSet && fieldData) {
                  processData(fieldData, selection.selectionSet);
                }
              } else if (selection.kind === "FragmentSpread") {
                const fragmentName = selection.name.value;
                const fragment = fragments[fragmentName];
                if (fragment) {
                  processDirectives(fragment.directives, result.data);
                  if (fragment.selectionSet) {
                    processData(result.data, fragment.selectionSet);
                  }
                }
              } else if (selection.kind === "InlineFragment") {
                if (selection.selectionSet) {
                  processData(result.data, selection.selectionSet);
                }
              }
            });
          }
        })
      );
    };
};

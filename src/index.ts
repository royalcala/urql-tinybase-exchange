import { Exchange } from 'urql';
import { pipe, tap } from 'wonka';
import { Store } from 'tinybase';
import { OperationDefinitionNode } from 'graphql';

export interface TinyBaseExchangeConfig {
    store: Store;
}

export const tinyBaseExchange = ({ store }: TinyBaseExchangeConfig): Exchange => {
    return ({ forward }) => (ops$) => {
        return pipe(
            ops$,
            forward,
            tap((result) => {
                if (!result.data) return;

                const { operation } = result;
                const { query } = operation;

                // Helper to process @dbMergeRow and @dbDeleteRow
                const processData = (data: any, selectionSet: any, parentType?: string) => {
                    if (!data || !selectionSet) return;

                    // If data is an array, process each item
                    if (Array.isArray(data)) {
                        data.forEach(item => processData(item, selectionSet, parentType));
                        return;
                    }

                    if (typeof data === 'object') {
                        // Iterate over selections to find fields and directives
                        selectionSet.selections.forEach((selection: any) => {
                            if (selection.kind === 'Field') {
                                const fieldName = selection.name.value;
                                const responseKey = selection.alias ? selection.alias.value : fieldName;
                                const fieldData = data[responseKey];

                                // Check for @dbMergeRow on this field
                                const mergeDirective = selection.directives?.find((d: any) => d.name.value === 'dbMergeRow');
                                if (mergeDirective) {
                                    const tableArg = mergeDirective.arguments?.find((a: any) => a.name.value === 'table');
                                    if (tableArg && tableArg.value.kind === 'StringValue') {
                                        const tableName = tableArg.value.value;
                                        if (fieldData && typeof fieldData === 'object') {
                                            if (Array.isArray(fieldData)) {
                                                fieldData.forEach(row => {
                                                    if (row.id) {
                                                        store.setRow(tableName, row.id, row);
                                                    }
                                                });
                                            } else if (fieldData.id) {
                                                store.setRow(tableName, fieldData.id, fieldData);
                                            }
                                        }
                                    }
                                }

                                // Check for @dbDeleteRow on this field (usually an ID field)
                                const deleteDirective = selection.directives?.find((d: any) => d.name.value === 'dbDeleteRow');
                                if (deleteDirective) {
                                    const tableArg = deleteDirective.arguments?.find((a: any) => a.name.value === 'table');
                                    if (tableArg && tableArg.value.kind === 'StringValue') {
                                        const tableName = tableArg.value.value;
                                        // The field value should be the ID
                                        if (fieldData) {
                                            // Assuming fieldData is the ID string/number
                                            store.delRow(tableName, String(fieldData));
                                        }
                                    }
                                }

                                // Recurse if the field has sub-selections
                                if (selection.selectionSet && fieldData) {
                                    processData(fieldData, selection.selectionSet);
                                }
                            } else if (selection.kind === 'InlineFragment') {
                                if (selection.selectionSet) {
                                    processData(data, selection.selectionSet);
                                }
                            }
                            // FragmentSpread resolution would require looking up fragments from the document
                        });
                    }
                };

                // We need to find the main operation definition
                const operationDef = query.definitions.find(d => d.kind === 'OperationDefinition') as OperationDefinitionNode;
                if (operationDef) {
                    processData(result.data, operationDef.selectionSet);
                }

            })
        );
    };
};

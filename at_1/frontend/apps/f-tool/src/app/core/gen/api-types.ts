export interface paths {
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managed-tables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listManagedTables"];
        put?: never;
        post: operations["createManagedTable"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managed-tables/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteManagedTable"];
        options?: never;
        head?: never;
        patch: operations["updateManagedTable"];
        trace?: never;
    };
    "/managed-tables/{id}/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getTableMeta"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managed-tables/{id}/rows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listRows"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managed-tables/{id}/rows/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["exportRows"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/managed-tables/{id}/rows/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["applyBatch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listConnections"];
        put?: never;
        post: operations["createConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["deleteConnection"];
        options?: never;
        head?: never;
        patch: operations["updateConnection"];
        trace?: never;
    };
    "/connections/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["testConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["testConnectionParams"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schema/tables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listSchemaTables"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/schema/tables/{schema}/{table}/columns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["previewSchemaTable"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{objectGuid}/auth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["setUserAuth"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listActions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/actions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateAction"];
        trace?: never;
    };
    "/me/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getMySettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateMySettings"];
        trace?: never;
    };
    "/home-config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHomeConfig"];
        put: operations["setHomeConfig"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/history/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["exportHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/history/{id}/overflow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getHistoryOverflow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            code: "invalid_credentials" | "unauthorized" | "forbidden" | "not_found" | "validation_failed" | "conflict" | "ldap_unavailable" | "session_unavailable" | "connection_unavailable" | "internal";
            message: string;
            details?: {
                [key: string]: unknown;
            };
        };
        AuthLevel: "admin" | "maintainer" | "user";
        LoginRequest: {
            username: string;
            password: string;
        };
        Me: {
            username: string;
            displayName: string;
            email?: string;
            actions: components["schemas"]["GrantedAction"][];
        };
        GrantedAction: {
            id: number;
            code: string;
            name: string;
            icon: string;
            authLevel: components["schemas"]["AuthLevel"];
        };
        Connection: {
            id: number;
            name: string;
            host: string;
            port: number;
            databaseName: string;
            username: string;
            options?: string;
            schemaName?: string;
            enabled: boolean;
        };
        ConnectionCreate: {
            name: string;
            host: string;
            port?: number;
            databaseName: string;
            username: string;
            password: string;
            options?: string;
            schemaName?: string;
            enabled?: boolean;
        };
        ConnectionUpdate: {
            name?: string;
            host?: string;
            port?: number;
            databaseName?: string;
            username?: string;
            password?: string;
            options?: string;
            schemaName?: string;
            enabled?: boolean;
        };
        ConnectionTestResult: {
            ok: boolean;
            message?: string;
            latencyMs?: number;
        };
        ManagedTable: {
            id: number;
            connectionId?: number | null;
            connectionName?: string | null;
            schemaName: string;
            tableName: string;
            displayName: string;
            slug: string;
            description?: string;
            sortOrder: number;
            enabled: boolean;
            writable: boolean;
            readonlyColumns?: string[];
            hiddenColumns?: string[];
            fixedColumns?: components["schemas"]["FixedColumn"][];
            createdAt: string;
            lastActivityAt?: string | null;
        };
        FixedColumn: {
            name: string;
            kind: "literal" | "now";
            value?: string;
            applyOn: "insert" | "update" | "both";
        };
        ManagedTableCreate: {
            connectionId?: number | null;
            schemaName: string;
            tableName: string;
            displayName: string;
            slug: string;
            description?: string;
            sortOrder?: number;
            readonlyColumns?: string[];
            hiddenColumns?: string[];
            fixedColumns?: components["schemas"]["FixedColumn"][];
        };
        ManagedTableUpdate: {
            displayName?: string;
            slug?: string;
            description?: string;
            sortOrder?: number;
            enabled?: boolean;
            readonlyColumns?: string[];
            hiddenColumns?: string[];
            fixedColumns?: components["schemas"]["FixedColumn"][];
        };
        TableMeta: {
            id: number;
            connectionId?: number | null;
            connectionName?: string | null;
            schemaName?: string;
            tableName?: string;
            displayName: string;
            primaryKey: string[];
            writable: boolean;
            hasRowVersion: boolean;
            columns: components["schemas"]["ColumnMeta"][];
            insertBlockedColumns?: string[];
        };
        ColumnMeta: {
            name: string;
            type: "string" | "int" | "decimal" | "bool" | "date" | "datetime" | "uuid";
            nullable: boolean;
            readonly: boolean;
            required?: boolean;
            maxLength?: number;
            searchable?: boolean;
            fixed?: boolean;
        };
        Row: {
            [key: string]: unknown;
        };
        RowPage: {
            rows: components["schemas"]["Row"][];
            total: number;
            limit: number;
            offset: number;
        };
        PrimaryKey: {
            [key: string]: unknown;
        };
        BatchRequest: {
            inserts?: components["schemas"]["Row"][];
            updates?: {
                key: components["schemas"]["PrimaryKey"];
                changes: components["schemas"]["Row"];
                rowVersion?: string;
            }[];
            deletes?: {
                key: components["schemas"]["PrimaryKey"];
                rowVersion?: string;
            }[];
        };
        BatchResult: {
            inserted: number;
            updated: number;
            deleted: number;
            insertedKeys?: components["schemas"]["PrimaryKey"][];
        };
        BatchError: components["schemas"]["Error"] & {
            details?: {
                operation?: "insert" | "update" | "delete";
                index?: number;
                reason?: "constraint_violation" | "row_version_mismatch" | "not_found" | "validation";
            };
        };
        SchemaTable: {
            schemaName: string;
            tableName: string;
            hasPrimaryKey: boolean;
        };
        SchemaTablePreview: {
            schemaName: string;
            tableName: string;
            primaryKey: string[];
            hasRowVersion: boolean;
            columns: components["schemas"]["ColumnMeta"][];
        };
        Action: {
            id: number;
            code: string;
            name: string;
            icon: string;
            sortOrder: number;
            enabled: boolean;
        };
        ActionUpdate: {
            name?: string;
            icon?: string;
            sortOrder?: number;
            enabled?: boolean;
        };
        UserSettings: {
            headerClock: "none" | "minute" | "second" | "custom";
            headerClockFormat: string;
        };
        UserSettingsUpdate: {
            headerClock?: "none" | "minute" | "second" | "custom";
            headerClockFormat?: string;
        };
        HomeConfig: {
            config: string | null;
            updatedBy?: string;
            updatedAt?: string;
        };
        HomeConfigUpdate: {
            config: string | null;
        };
        UserWithAuth: {
            objectGuid: string;
            username: string;
            displayName: string;
            email?: string;
            lastLoginAt?: string;
            auth: components["schemas"]["UserAuthEntry"][];
        };
        UserAuthEntry: {
            actionId: number;
            actionCode: string;
            authLevel: components["schemas"]["AuthLevel"];
        };
        AuthAssignment: {
            actionId: number;
            authLevel: components["schemas"]["AuthLevel"];
        };
        HistoryEntry: {
            id: number;
            occurredAt: string;
            objectGuid?: string;
            username: string;
            actionCode: string;
            operation: string;
            target?: string;
            detail?: {
                [key: string]: unknown;
            };
            result: "success" | "failure";
            errorCode?: string;
            clientIp?: string;
        };
        HistoryPage: {
            entries: components["schemas"]["HistoryEntry"][];
            total: number;
            limit: number;
            offset: number;
        };
    };
    responses: {
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        ManagedTableId: number;
        Preds: string;
        ConnectionId: number;
        ActionId: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    "Set-Cookie"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    listManagedTables: {
        parameters: {
            query?: {
                all?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tables: components["schemas"]["ManagedTable"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    createManagedTable: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManagedTableCreate"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManagedTable"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteManagedTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ManagedTableId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateManagedTable: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ManagedTableId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManagedTableUpdate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ManagedTable"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getTableMeta: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ManagedTableId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TableMeta"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listRows: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                preds?: components["parameters"]["Preds"];
                orderBy?: string;
                order?: "asc" | "desc";
            };
            header?: never;
            path: {
                id: components["parameters"]["ManagedTableId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RowPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    exportRows: {
        parameters: {
            query?: {
                preds?: components["parameters"]["Preds"];
            };
            header?: never;
            path: {
                id: components["parameters"]["ManagedTableId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    applyBatch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ManagedTableId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BatchRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BatchResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BatchError"];
                };
            };
        };
    };
    listConnections: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        connections: components["schemas"]["Connection"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    createConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConnectionCreate"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Connection"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    deleteConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConnectionUpdate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Connection"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    testConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ConnectionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    testConnectionParams: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConnectionCreate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    listSchemaTables: {
        parameters: {
            query?: {
                connectionId?: number;
                schema?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        tables: components["schemas"]["SchemaTable"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    previewSchemaTable: {
        parameters: {
            query?: {
                connectionId?: number;
            };
            header?: never;
            path: {
                schema: string;
                table: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemaTablePreview"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    listUsers: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                preds?: components["parameters"]["Preds"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        users: components["schemas"]["UserWithAuth"][];
                        total: number;
                        limit: number;
                        offset: number;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    setUserAuth: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                objectGuid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    assignments: components["schemas"]["AuthAssignment"][];
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserWithAuth"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listActions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        actions: components["schemas"]["Action"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    updateAction: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: components["parameters"]["ActionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActionUpdate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Action"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    getMySettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserSettings"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    updateMySettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserSettingsUpdate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserSettings"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
        };
    };
    getHomeConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HomeConfig"];
                };
            };
            401: components["responses"]["Unauthorized"];
        };
    };
    setHomeConfig: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HomeConfigUpdate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HomeConfig"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    listHistory: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                preds?: components["parameters"]["Preds"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HistoryPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    exportHistory: {
        parameters: {
            query?: {
                preds?: components["parameters"]["Preds"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    getHistoryOverflow: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
}

package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/oapi-codegen/runtime"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

const (
	CookieAuthScopes = "cookieAuth.Scopes"
)

const (
	Admin      AuthLevel = "admin"
	Maintainer AuthLevel = "maintainer"
	User       AuthLevel = "user"
)

const (
	BatchErrorCodeConflict              BatchErrorCode = "conflict"
	BatchErrorCodeConnectionUnavailable BatchErrorCode = "connection_unavailable"
	BatchErrorCodeForbidden             BatchErrorCode = "forbidden"
	BatchErrorCodeInternal              BatchErrorCode = "internal"
	BatchErrorCodeInvalidCredentials    BatchErrorCode = "invalid_credentials"
	BatchErrorCodeLdapUnavailable       BatchErrorCode = "ldap_unavailable"
	BatchErrorCodeNotFound              BatchErrorCode = "not_found"
	BatchErrorCodeSessionUnavailable    BatchErrorCode = "session_unavailable"
	BatchErrorCodeUnauthorized          BatchErrorCode = "unauthorized"
	BatchErrorCodeValidationFailed      BatchErrorCode = "validation_failed"
)

const (
	BatchErrorDetailsOperationDelete BatchErrorDetailsOperation = "delete"
	BatchErrorDetailsOperationInsert BatchErrorDetailsOperation = "insert"
	BatchErrorDetailsOperationUpdate BatchErrorDetailsOperation = "update"
)

const (
	BatchErrorDetailsReasonConstraintViolation BatchErrorDetailsReason = "constraint_violation"
	BatchErrorDetailsReasonNotFound            BatchErrorDetailsReason = "not_found"
	BatchErrorDetailsReasonRowVersionMismatch  BatchErrorDetailsReason = "row_version_mismatch"
	BatchErrorDetailsReasonValidation          BatchErrorDetailsReason = "validation"
)

const (
	Bool     ColumnMetaType = "bool"
	Date     ColumnMetaType = "date"
	Datetime ColumnMetaType = "datetime"
	Decimal  ColumnMetaType = "decimal"
	Int      ColumnMetaType = "int"
	String   ColumnMetaType = "string"
	Uuid     ColumnMetaType = "uuid"
)

const (
	ErrorCodeConflict              ErrorCode = "conflict"
	ErrorCodeConnectionUnavailable ErrorCode = "connection_unavailable"
	ErrorCodeForbidden             ErrorCode = "forbidden"
	ErrorCodeInternal              ErrorCode = "internal"
	ErrorCodeInvalidCredentials    ErrorCode = "invalid_credentials"
	ErrorCodeLdapUnavailable       ErrorCode = "ldap_unavailable"
	ErrorCodeNotFound              ErrorCode = "not_found"
	ErrorCodeSessionUnavailable    ErrorCode = "session_unavailable"
	ErrorCodeUnauthorized          ErrorCode = "unauthorized"
	ErrorCodeValidationFailed      ErrorCode = "validation_failed"
)

const (
	FixedColumnApplyOnBoth   FixedColumnApplyOn = "both"
	FixedColumnApplyOnInsert FixedColumnApplyOn = "insert"
	FixedColumnApplyOnUpdate FixedColumnApplyOn = "update"
)

const (
	Literal FixedColumnKind = "literal"
	Now     FixedColumnKind = "now"
)

const (
	Failure HistoryEntryResult = "failure"
	Success HistoryEntryResult = "success"
)

const (
	UserSettingsHeaderClockCustom UserSettingsHeaderClock = "custom"
	UserSettingsHeaderClockMinute UserSettingsHeaderClock = "minute"
	UserSettingsHeaderClockNone   UserSettingsHeaderClock = "none"
	UserSettingsHeaderClockSecond UserSettingsHeaderClock = "second"
)

const (
	UserSettingsUpdateHeaderClockCustom UserSettingsUpdateHeaderClock = "custom"
	UserSettingsUpdateHeaderClockMinute UserSettingsUpdateHeaderClock = "minute"
	UserSettingsUpdateHeaderClockNone   UserSettingsUpdateHeaderClock = "none"
	UserSettingsUpdateHeaderClockSecond UserSettingsUpdateHeaderClock = "second"
)

const (
	Asc  ListRowsParamsOrder = "asc"
	Desc ListRowsParamsOrder = "desc"
)

type Action struct {
	Code      string `json:"code"`
	Enabled   bool   `json:"enabled"`
	Icon      string `json:"icon"`
	Id        int    `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
}

type ActionUpdate struct {
	Enabled   *bool   `json:"enabled,omitempty"`
	Icon      *string `json:"icon,omitempty"`
	Name      *string `json:"name,omitempty"`
	SortOrder *int    `json:"sortOrder,omitempty"`
}

type AuthAssignment struct {
	ActionId  int       `json:"actionId"`
	AuthLevel AuthLevel `json:"authLevel"`
}

type AuthLevel string

type BatchError struct {
	Code    BatchErrorCode `json:"code"`
	Details *struct {
		Index     *int                        `json:"index,omitempty"`
		Operation *BatchErrorDetailsOperation `json:"operation,omitempty"`
		Reason    *BatchErrorDetailsReason    `json:"reason,omitempty"`
	} `json:"details,omitempty"`
	Message string `json:"message"`
}

type BatchErrorCode string

type BatchErrorDetailsOperation string

type BatchErrorDetailsReason string

type BatchRequest struct {
	Deletes *[]struct {
		Key        PrimaryKey `json:"key"`
		RowVersion *string    `json:"rowVersion,omitempty"`
	} `json:"deletes,omitempty"`
	Inserts *[]Row `json:"inserts,omitempty"`
	Updates *[]struct {
		Changes    Row        `json:"changes"`
		Key        PrimaryKey `json:"key"`
		RowVersion *string    `json:"rowVersion,omitempty"`
	} `json:"updates,omitempty"`
}

type BatchResult struct {
	Deleted      int           `json:"deleted"`
	Inserted     int           `json:"inserted"`
	InsertedKeys *[]PrimaryKey `json:"insertedKeys,omitempty"`
	Updated      int           `json:"updated"`
}

type ColumnMeta struct {
	Fixed      *bool          `json:"fixed,omitempty"`
	MaxLength  *int           `json:"maxLength,omitempty"`
	Name       string         `json:"name"`
	Nullable   bool           `json:"nullable"`
	Readonly   bool           `json:"readonly"`
	Required   *bool          `json:"required,omitempty"`
	Searchable *bool          `json:"searchable,omitempty"`
	Type       ColumnMetaType `json:"type"`
}

type ColumnMetaType string

type Connection struct {
	DatabaseName string  `json:"databaseName"`
	Enabled      bool    `json:"enabled"`
	Host         string  `json:"host"`
	Id           int     `json:"id"`
	Name         string  `json:"name"`
	Options      *string `json:"options,omitempty"`
	Port         int     `json:"port"`
	SchemaName   *string `json:"schemaName,omitempty"`
	Username     string  `json:"username"`
}

type ConnectionCreate struct {
	DatabaseName string  `json:"databaseName"`
	Enabled      *bool   `json:"enabled,omitempty"`
	Host         string  `json:"host"`
	Name         string  `json:"name"`
	Options      *string `json:"options,omitempty"`
	Password     string  `json:"password"`
	Port         *int    `json:"port,omitempty"`
	SchemaName   *string `json:"schemaName,omitempty"`
	Username     string  `json:"username"`
}

type ConnectionTestResult struct {
	LatencyMs *int    `json:"latencyMs,omitempty"`
	Message   *string `json:"message,omitempty"`
	Ok        bool    `json:"ok"`
}

type ConnectionUpdate struct {
	DatabaseName *string `json:"databaseName,omitempty"`
	Enabled      *bool   `json:"enabled,omitempty"`
	Host         *string `json:"host,omitempty"`
	Name         *string `json:"name,omitempty"`
	Options      *string `json:"options,omitempty"`
	Password     *string `json:"password,omitempty"`
	Port         *int    `json:"port,omitempty"`
	SchemaName   *string `json:"schemaName,omitempty"`
	Username     *string `json:"username,omitempty"`
}

type Error struct {
	Code    ErrorCode               `json:"code"`
	Details *map[string]interface{} `json:"details,omitempty"`
	Message string                  `json:"message"`
}

type ErrorCode string

type FixedColumn struct {
	ApplyOn FixedColumnApplyOn `json:"applyOn"`
	Kind    FixedColumnKind    `json:"kind"`
	Name    string             `json:"name"`
	Value   *string            `json:"value,omitempty"`
}

type FixedColumnApplyOn string

type FixedColumnKind string

type GrantedAction struct {
	AuthLevel AuthLevel `json:"authLevel"`
	Code      string    `json:"code"`
	Icon      string    `json:"icon"`
	Id        int       `json:"id"`
	Name      string    `json:"name"`
}

type HistoryEntry struct {
	ActionCode string                  `json:"actionCode"`
	ClientIp   *string                 `json:"clientIp,omitempty"`
	Detail     *map[string]interface{} `json:"detail,omitempty"`
	ErrorCode  *string                 `json:"errorCode,omitempty"`
	Id         int64                   `json:"id"`
	ObjectGuid *openapi_types.UUID     `json:"objectGuid,omitempty"`
	OccurredAt time.Time               `json:"occurredAt"`
	Operation  string                  `json:"operation"`
	Result     HistoryEntryResult      `json:"result"`
	Target     *string                 `json:"target,omitempty"`
	Username   string                  `json:"username"`
}

type HistoryEntryResult string

type HistoryPage struct {
	Entries []HistoryEntry `json:"entries"`
	Limit   int            `json:"limit"`
	Offset  int            `json:"offset"`
	Total   int            `json:"total"`
}

type HomeConfig struct {
	Config    *string    `json:"config"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
	UpdatedBy *string    `json:"updatedBy,omitempty"`
}

type HomeConfigUpdate struct {
	Config *string `json:"config"`
}

type LoginRequest struct {
	Password string `json:"password"`
	Username string `json:"username"`
}

type ManagedTable struct {
	ConnectionId    *int           `json:"connectionId"`
	ConnectionName  *string        `json:"connectionName"`
	CreatedAt       time.Time      `json:"createdAt"`
	Description     *string        `json:"description,omitempty"`
	DisplayName     string         `json:"displayName"`
	Enabled         bool           `json:"enabled"`
	FixedColumns    *[]FixedColumn `json:"fixedColumns,omitempty"`
	HiddenColumns   *[]string      `json:"hiddenColumns,omitempty"`
	Id              int            `json:"id"`
	LastActivityAt  *time.Time     `json:"lastActivityAt"`
	ReadonlyColumns *[]string      `json:"readonlyColumns,omitempty"`
	SchemaName      string         `json:"schemaName"`
	Slug            string         `json:"slug"`
	SortOrder       int            `json:"sortOrder"`
	TableName       string         `json:"tableName"`
	Writable        bool           `json:"writable"`
}

type ManagedTableCreate struct {
	ConnectionId    *int           `json:"connectionId"`
	Description     *string        `json:"description,omitempty"`
	DisplayName     string         `json:"displayName"`
	FixedColumns    *[]FixedColumn `json:"fixedColumns,omitempty"`
	HiddenColumns   *[]string      `json:"hiddenColumns,omitempty"`
	ReadonlyColumns *[]string      `json:"readonlyColumns,omitempty"`
	SchemaName      string         `json:"schemaName"`
	Slug            string         `json:"slug"`
	SortOrder       *int           `json:"sortOrder,omitempty"`
	TableName       string         `json:"tableName"`
}

type ManagedTableUpdate struct {
	Description     *string        `json:"description,omitempty"`
	DisplayName     *string        `json:"displayName,omitempty"`
	Enabled         *bool          `json:"enabled,omitempty"`
	FixedColumns    *[]FixedColumn `json:"fixedColumns,omitempty"`
	HiddenColumns   *[]string      `json:"hiddenColumns,omitempty"`
	ReadonlyColumns *[]string      `json:"readonlyColumns,omitempty"`
	Slug            *string        `json:"slug,omitempty"`
	SortOrder       *int           `json:"sortOrder,omitempty"`
}

type Me struct {
	Actions     []GrantedAction `json:"actions"`
	DisplayName string          `json:"displayName"`
	Email       *string         `json:"email,omitempty"`
	Username    string          `json:"username"`
}

type PrimaryKey map[string]interface{}

type Row map[string]interface{}

type RowPage struct {
	Limit  int   `json:"limit"`
	Offset int   `json:"offset"`
	Rows   []Row `json:"rows"`
	Total  int   `json:"total"`
}

type SchemaTable struct {
	HasPrimaryKey bool   `json:"hasPrimaryKey"`
	SchemaName    string `json:"schemaName"`
	TableName     string `json:"tableName"`
}

type SchemaTablePreview struct {
	Columns       []ColumnMeta `json:"columns"`
	HasRowVersion bool         `json:"hasRowVersion"`
	PrimaryKey    []string     `json:"primaryKey"`
	SchemaName    string       `json:"schemaName"`
	TableName     string       `json:"tableName"`
}

type TableMeta struct {
	Columns              []ColumnMeta `json:"columns"`
	ConnectionId         *int         `json:"connectionId"`
	ConnectionName       *string      `json:"connectionName"`
	DisplayName          string       `json:"displayName"`
	HasRowVersion        bool         `json:"hasRowVersion"`
	Id                   int          `json:"id"`
	InsertBlockedColumns *[]string    `json:"insertBlockedColumns,omitempty"`
	PrimaryKey           []string     `json:"primaryKey"`
	SchemaName           *string      `json:"schemaName,omitempty"`
	TableName            *string      `json:"tableName,omitempty"`
	Writable             bool         `json:"writable"`
}

type UserAuthEntry struct {
	ActionCode string    `json:"actionCode"`
	ActionId   int       `json:"actionId"`
	AuthLevel  AuthLevel `json:"authLevel"`
}

type UserSettings struct {
	HeaderClock       UserSettingsHeaderClock `json:"headerClock"`
	HeaderClockFormat string                  `json:"headerClockFormat"`
}

type UserSettingsHeaderClock string

type UserSettingsUpdate struct {
	HeaderClock       *UserSettingsUpdateHeaderClock `json:"headerClock,omitempty"`
	HeaderClockFormat *string                        `json:"headerClockFormat,omitempty"`
}

type UserSettingsUpdateHeaderClock string

type UserWithAuth struct {
	Auth        []UserAuthEntry    `json:"auth"`
	DisplayName string             `json:"displayName"`
	Email       *string            `json:"email,omitempty"`
	LastLoginAt *time.Time         `json:"lastLoginAt,omitempty"`
	ObjectGuid  openapi_types.UUID `json:"objectGuid"`
	Username    string             `json:"username"`
}

type ActionId = int

type ConnectionId = int

type ManagedTableId = int

type Preds = string

type BadRequest = Error

type Forbidden = Error

type NotFound = Error

type Unauthorized = Error

type ListUsersParams struct {
	Limit  *int   `form:"limit,omitempty" json:"limit,omitempty"`
	Offset *int   `form:"offset,omitempty" json:"offset,omitempty"`
	Preds  *Preds `form:"preds,omitempty" json:"preds,omitempty"`
}

type SetUserAuthJSONBody struct {
	Assignments []AuthAssignment `json:"assignments"`
}

type ListHistoryParams struct {
	Limit  *int   `form:"limit,omitempty" json:"limit,omitempty"`
	Offset *int   `form:"offset,omitempty" json:"offset,omitempty"`
	Preds  *Preds `form:"preds,omitempty" json:"preds,omitempty"`
}

type ExportHistoryParams struct {
	Preds *Preds `form:"preds,omitempty" json:"preds,omitempty"`
}

type ListManagedTablesParams struct {
	All *bool `form:"all,omitempty" json:"all,omitempty"`
}

type ListRowsParams struct {
	Limit   *int                 `form:"limit,omitempty" json:"limit,omitempty"`
	Offset  *int                 `form:"offset,omitempty" json:"offset,omitempty"`
	Preds   *Preds               `form:"preds,omitempty" json:"preds,omitempty"`
	OrderBy *string              `form:"orderBy,omitempty" json:"orderBy,omitempty"`
	Order   *ListRowsParamsOrder `form:"order,omitempty" json:"order,omitempty"`
}

type ListRowsParamsOrder string

type ExportRowsParams struct {
	Preds *Preds `form:"preds,omitempty" json:"preds,omitempty"`
}

type ListSchemaTablesParams struct {
	ConnectionId *int    `form:"connectionId,omitempty" json:"connectionId,omitempty"`
	Schema       *string `form:"schema,omitempty" json:"schema,omitempty"`
}

type PreviewSchemaTableParams struct {
	ConnectionId *int `form:"connectionId,omitempty" json:"connectionId,omitempty"`
}

type UpdateActionJSONRequestBody = ActionUpdate

type SetUserAuthJSONRequestBody SetUserAuthJSONBody

type LoginJSONRequestBody = LoginRequest

type CreateConnectionJSONRequestBody = ConnectionCreate

type TestConnectionParamsJSONRequestBody = ConnectionCreate

type UpdateConnectionJSONRequestBody = ConnectionUpdate

type SetHomeConfigJSONRequestBody = HomeConfigUpdate

type CreateManagedTableJSONRequestBody = ManagedTableCreate

type UpdateManagedTableJSONRequestBody = ManagedTableUpdate

type ApplyBatchJSONRequestBody = BatchRequest

type UpdateMySettingsJSONRequestBody = UserSettingsUpdate

type ServerInterface interface {
	ListActions(c *gin.Context)

	UpdateAction(c *gin.Context, id ActionId)

	ListUsers(c *gin.Context, params ListUsersParams)

	SetUserAuth(c *gin.Context, objectGuid openapi_types.UUID)

	Login(c *gin.Context)

	Logout(c *gin.Context)

	GetMe(c *gin.Context)

	ListConnections(c *gin.Context)

	CreateConnection(c *gin.Context)

	TestConnectionParams(c *gin.Context)

	DeleteConnection(c *gin.Context, id ConnectionId)

	UpdateConnection(c *gin.Context, id ConnectionId)

	TestConnection(c *gin.Context, id ConnectionId)

	ListHistory(c *gin.Context, params ListHistoryParams)

	ExportHistory(c *gin.Context, params ExportHistoryParams)

	GetHistoryOverflow(c *gin.Context, id int)

	GetHomeConfig(c *gin.Context)

	SetHomeConfig(c *gin.Context)

	ListManagedTables(c *gin.Context, params ListManagedTablesParams)

	CreateManagedTable(c *gin.Context)

	DeleteManagedTable(c *gin.Context, id ManagedTableId)

	UpdateManagedTable(c *gin.Context, id ManagedTableId)

	GetTableMeta(c *gin.Context, id ManagedTableId)

	ListRows(c *gin.Context, id ManagedTableId, params ListRowsParams)

	ApplyBatch(c *gin.Context, id ManagedTableId)

	ExportRows(c *gin.Context, id ManagedTableId, params ExportRowsParams)

	GetMySettings(c *gin.Context)

	UpdateMySettings(c *gin.Context)

	ListSchemaTables(c *gin.Context, params ListSchemaTablesParams)

	PreviewSchemaTable(c *gin.Context, schema string, table string, params PreviewSchemaTableParams)
}

type ServerInterfaceWrapper struct {
	Handler            ServerInterface
	HandlerMiddlewares []MiddlewareFunc
	ErrorHandler       func(*gin.Context, error, int)
}

type MiddlewareFunc func(c *gin.Context)

func (siw *ServerInterfaceWrapper) ListActions(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListActions(c)
}

func (siw *ServerInterfaceWrapper) UpdateAction(c *gin.Context) {

	var err error

	var id ActionId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.UpdateAction(c, id)
}

func (siw *ServerInterfaceWrapper) ListUsers(c *gin.Context) {

	var err error

	c.Set(CookieAuthScopes, []string{})

	var params ListUsersParams

	err = runtime.BindQueryParameter("form", true, false, "limit", c.Request.URL.Query(), &params.Limit)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter limit: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "offset", c.Request.URL.Query(), &params.Offset)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter offset: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "preds", c.Request.URL.Query(), &params.Preds)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter preds: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListUsers(c, params)
}

func (siw *ServerInterfaceWrapper) SetUserAuth(c *gin.Context) {

	var err error

	var objectGuid openapi_types.UUID

	err = runtime.BindStyledParameterWithOptions("simple", "objectGuid", c.Param("objectGuid"), &objectGuid, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter objectGuid: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.SetUserAuth(c, objectGuid)
}

func (siw *ServerInterfaceWrapper) Login(c *gin.Context) {

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.Login(c)
}

func (siw *ServerInterfaceWrapper) Logout(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.Logout(c)
}

func (siw *ServerInterfaceWrapper) GetMe(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.GetMe(c)
}

func (siw *ServerInterfaceWrapper) ListConnections(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListConnections(c)
}

func (siw *ServerInterfaceWrapper) CreateConnection(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.CreateConnection(c)
}

func (siw *ServerInterfaceWrapper) TestConnectionParams(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.TestConnectionParams(c)
}

func (siw *ServerInterfaceWrapper) DeleteConnection(c *gin.Context) {

	var err error

	var id ConnectionId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.DeleteConnection(c, id)
}

func (siw *ServerInterfaceWrapper) UpdateConnection(c *gin.Context) {

	var err error

	var id ConnectionId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.UpdateConnection(c, id)
}

func (siw *ServerInterfaceWrapper) TestConnection(c *gin.Context) {

	var err error

	var id ConnectionId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.TestConnection(c, id)
}

func (siw *ServerInterfaceWrapper) ListHistory(c *gin.Context) {

	var err error

	c.Set(CookieAuthScopes, []string{})

	var params ListHistoryParams

	err = runtime.BindQueryParameter("form", true, false, "limit", c.Request.URL.Query(), &params.Limit)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter limit: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "offset", c.Request.URL.Query(), &params.Offset)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter offset: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "preds", c.Request.URL.Query(), &params.Preds)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter preds: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListHistory(c, params)
}

func (siw *ServerInterfaceWrapper) ExportHistory(c *gin.Context) {

	var err error

	c.Set(CookieAuthScopes, []string{})

	var params ExportHistoryParams

	err = runtime.BindQueryParameter("form", true, false, "preds", c.Request.URL.Query(), &params.Preds)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter preds: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ExportHistory(c, params)
}

func (siw *ServerInterfaceWrapper) GetHistoryOverflow(c *gin.Context) {

	var err error

	var id int

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.GetHistoryOverflow(c, id)
}

func (siw *ServerInterfaceWrapper) GetHomeConfig(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.GetHomeConfig(c)
}

func (siw *ServerInterfaceWrapper) SetHomeConfig(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.SetHomeConfig(c)
}

func (siw *ServerInterfaceWrapper) ListManagedTables(c *gin.Context) {

	var err error

	c.Set(CookieAuthScopes, []string{})

	var params ListManagedTablesParams

	err = runtime.BindQueryParameter("form", true, false, "all", c.Request.URL.Query(), &params.All)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter all: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListManagedTables(c, params)
}

func (siw *ServerInterfaceWrapper) CreateManagedTable(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.CreateManagedTable(c)
}

func (siw *ServerInterfaceWrapper) DeleteManagedTable(c *gin.Context) {

	var err error

	var id ManagedTableId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.DeleteManagedTable(c, id)
}

func (siw *ServerInterfaceWrapper) UpdateManagedTable(c *gin.Context) {

	var err error

	var id ManagedTableId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.UpdateManagedTable(c, id)
}

func (siw *ServerInterfaceWrapper) GetTableMeta(c *gin.Context) {

	var err error

	var id ManagedTableId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.GetTableMeta(c, id)
}

func (siw *ServerInterfaceWrapper) ListRows(c *gin.Context) {

	var err error

	var id ManagedTableId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	var params ListRowsParams

	err = runtime.BindQueryParameter("form", true, false, "limit", c.Request.URL.Query(), &params.Limit)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter limit: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "offset", c.Request.URL.Query(), &params.Offset)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter offset: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "preds", c.Request.URL.Query(), &params.Preds)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter preds: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "orderBy", c.Request.URL.Query(), &params.OrderBy)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter orderBy: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "order", c.Request.URL.Query(), &params.Order)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter order: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListRows(c, id, params)
}

func (siw *ServerInterfaceWrapper) ApplyBatch(c *gin.Context) {

	var err error

	var id ManagedTableId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ApplyBatch(c, id)
}

func (siw *ServerInterfaceWrapper) ExportRows(c *gin.Context) {

	var err error

	var id ManagedTableId

	err = runtime.BindStyledParameterWithOptions("simple", "id", c.Param("id"), &id, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter id: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	var params ExportRowsParams

	err = runtime.BindQueryParameter("form", true, false, "preds", c.Request.URL.Query(), &params.Preds)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter preds: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ExportRows(c, id, params)
}

func (siw *ServerInterfaceWrapper) GetMySettings(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.GetMySettings(c)
}

func (siw *ServerInterfaceWrapper) UpdateMySettings(c *gin.Context) {

	c.Set(CookieAuthScopes, []string{})

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.UpdateMySettings(c)
}

func (siw *ServerInterfaceWrapper) ListSchemaTables(c *gin.Context) {

	var err error

	c.Set(CookieAuthScopes, []string{})

	var params ListSchemaTablesParams

	err = runtime.BindQueryParameter("form", true, false, "connectionId", c.Request.URL.Query(), &params.ConnectionId)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter connectionId: %w", err), http.StatusBadRequest)
		return
	}

	err = runtime.BindQueryParameter("form", true, false, "schema", c.Request.URL.Query(), &params.Schema)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter schema: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.ListSchemaTables(c, params)
}

func (siw *ServerInterfaceWrapper) PreviewSchemaTable(c *gin.Context) {

	var err error

	var schema string

	err = runtime.BindStyledParameterWithOptions("simple", "schema", c.Param("schema"), &schema, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter schema: %w", err), http.StatusBadRequest)
		return
	}

	var table string

	err = runtime.BindStyledParameterWithOptions("simple", "table", c.Param("table"), &table, runtime.BindStyledParameterOptions{Explode: false, Required: true})
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter table: %w", err), http.StatusBadRequest)
		return
	}

	c.Set(CookieAuthScopes, []string{})

	var params PreviewSchemaTableParams

	err = runtime.BindQueryParameter("form", true, false, "connectionId", c.Request.URL.Query(), &params.ConnectionId)
	if err != nil {
		siw.ErrorHandler(c, fmt.Errorf("Invalid format for parameter connectionId: %w", err), http.StatusBadRequest)
		return
	}

	for _, middleware := range siw.HandlerMiddlewares {
		middleware(c)
		if c.IsAborted() {
			return
		}
	}

	siw.Handler.PreviewSchemaTable(c, schema, table, params)
}

type GinServerOptions struct {
	BaseURL      string
	Middlewares  []MiddlewareFunc
	ErrorHandler func(*gin.Context, error, int)
}

func RegisterHandlers(router gin.IRouter, si ServerInterface) {
	RegisterHandlersWithOptions(router, si, GinServerOptions{})
}

func RegisterHandlersWithOptions(router gin.IRouter, si ServerInterface, options GinServerOptions) {
	errorHandler := options.ErrorHandler
	if errorHandler == nil {
		errorHandler = func(c *gin.Context, err error, statusCode int) {
			c.JSON(statusCode, gin.H{"msg": err.Error()})
		}
	}

	wrapper := ServerInterfaceWrapper{
		Handler:            si,
		HandlerMiddlewares: options.Middlewares,
		ErrorHandler:       errorHandler,
	}

	router.GET(options.BaseURL+"/admin/actions", wrapper.ListActions)
	router.PATCH(options.BaseURL+"/admin/actions/:id", wrapper.UpdateAction)
	router.GET(options.BaseURL+"/admin/users", wrapper.ListUsers)
	router.PUT(options.BaseURL+"/admin/users/:objectGuid/auth", wrapper.SetUserAuth)
	router.POST(options.BaseURL+"/auth/login", wrapper.Login)
	router.POST(options.BaseURL+"/auth/logout", wrapper.Logout)
	router.GET(options.BaseURL+"/auth/me", wrapper.GetMe)
	router.GET(options.BaseURL+"/connections", wrapper.ListConnections)
	router.POST(options.BaseURL+"/connections", wrapper.CreateConnection)
	router.POST(options.BaseURL+"/connections/test", wrapper.TestConnectionParams)
	router.DELETE(options.BaseURL+"/connections/:id", wrapper.DeleteConnection)
	router.PATCH(options.BaseURL+"/connections/:id", wrapper.UpdateConnection)
	router.POST(options.BaseURL+"/connections/:id/test", wrapper.TestConnection)
	router.GET(options.BaseURL+"/history", wrapper.ListHistory)
	router.GET(options.BaseURL+"/history/export", wrapper.ExportHistory)
	router.GET(options.BaseURL+"/history/:id/overflow", wrapper.GetHistoryOverflow)
	router.GET(options.BaseURL+"/home-config", wrapper.GetHomeConfig)
	router.PUT(options.BaseURL+"/home-config", wrapper.SetHomeConfig)
	router.GET(options.BaseURL+"/managed-tables", wrapper.ListManagedTables)
	router.POST(options.BaseURL+"/managed-tables", wrapper.CreateManagedTable)
	router.DELETE(options.BaseURL+"/managed-tables/:id", wrapper.DeleteManagedTable)
	router.PATCH(options.BaseURL+"/managed-tables/:id", wrapper.UpdateManagedTable)
	router.GET(options.BaseURL+"/managed-tables/:id/meta", wrapper.GetTableMeta)
	router.GET(options.BaseURL+"/managed-tables/:id/rows", wrapper.ListRows)
	router.POST(options.BaseURL+"/managed-tables/:id/rows/batch", wrapper.ApplyBatch)
	router.GET(options.BaseURL+"/managed-tables/:id/rows/export", wrapper.ExportRows)
	router.GET(options.BaseURL+"/me/settings", wrapper.GetMySettings)
	router.PATCH(options.BaseURL+"/me/settings", wrapper.UpdateMySettings)
	router.GET(options.BaseURL+"/schema/tables", wrapper.ListSchemaTables)
	router.GET(options.BaseURL+"/schema/tables/:schema/:table/columns", wrapper.PreviewSchemaTable)
}

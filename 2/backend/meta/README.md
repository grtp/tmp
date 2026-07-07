# メタデータ定義フォーマット

`meta/tables/*.yaml` がビルドに組み込まれるテーブル定義。
**テーブルの追加 = YAMLを1枚追加して再ビルド**。Goコードの変更は不要。

```
meta/
├── table.schema.json      # YAML の JSON Schema(CI/ビルド時検証用)
└── tables/
    ├── products.yaml        # 例: 通常のマスタテーブル
    └── app_user_roles.yaml  # 例: 権限テーブル自身(guards付き)
```

## 識別子の規約

- **ファイル名(拡張子除く) = API 上のテーブル識別子**(`/api/v1/tables/{name}`)
- `^[a-z][a-z0-9_]{0,63}$` に一致すること(OpenAPI の TableName と同一制約)
- `schema` + `table` が実際の SQL Server 上の位置

## トップレベル項目

| 項目 | 必須 | 意味 |
|---|---|---|
| `schema` | ✓ | SQL Server スキーマ(dbo 等) |
| `table` | ✓ | 物理テーブル名 |
| `displayName` | ✓ | 画面表示名 |
| `description` | | メニュー等での説明 |
| `primaryKey` | ✓ | 主キー列名の配列(複合キー対応) |
| `rowVersionColumn` | | rowversion 列名。指定すると楽観ロック有効 |
| `permissions.read` | ✓ | 閲覧可能ロール。**空配列 = 誰も見えない**(一時非公開に使う) |
| `permissions.write` | ✓ | 追加・編集・削除可能ロール |
| `guards` | | 汎用CRUDへの追加制約(下記) |
| `columns` | ✓ | 列定義の配列 |

## 列定義

| 項目 | 必須 | 既定 | 意味 |
|---|---|---|---|
| `name` | ✓ | | 物理列名 |
| `displayName` | | name | ヘッダ表示名 |
| `type` | ✓ | | 正規化型: `string` `int` `decimal` `bool` `date` `datetime` `uuid` |
| `nullable` | | false | NULL 許可 |
| `readonly` | | false | IDENTITY・計算列・DB管理列。INSERT/UPDATE 対象外、編集UI無効 |
| `required` | | false | INSERT 時に必須(UI バリデーション + サーバー検証) |
| `searchable` | | false | `?q=` の LIKE 検索対象 |
| `maxLength` | | | string の最大長 |
| `min` / `max` | | | 数値範囲 |
| `enum` | | | 許容値リスト。フロントはセレクトボックスを描画 |

**YAML に書かれていない物理列は API に一切現れない**(SELECT もしない)。
機密列を持つテーブルの部分公開はこの仕組みで行う。

## guards(汎用CRUDへの追加制約)

| 項目 | 意味 |
|---|---|
| `denyInsert` | 行追加を 403 にする(例: 登録経路が別にあるテーブル) |
| `denyDelete` | 行削除を 403 にする |
| `protect: lastRowMatching` | `column = value` に一致する最終行を消す操作を 409 にする(例: 最後の admin 保護) |

## 型マッピング(起動時突合)

サーバー起動時に `INFORMATION_SCHEMA.COLUMNS` と全定義を突合し、
不一致があれば**起動失敗**させる(タイポや型変更の事故を即検知)。

| YAML type | 許容する SQL Server 型 |
|---|---|
| `string`   | nvarchar, varchar, nchar, char, ntext |
| `int`      | int, bigint, smallint, tinyint |
| `decimal`  | decimal, numeric, money, float, real |
| `bool`     | bit |
| `date`     | date |
| `datetime` | datetime, datetime2, smalldatetime, datetimeoffset |
| `uuid`     | uniqueidentifier |

突合で検査する項目:

1. `schema.table` が存在するか
2. YAML の全列が実在するか(逆方向は不問 = 書いてない列があってもよい)
3. 型が上表の範囲で一致するか
4. `nullable` が実DBと矛盾しないか(YAML=false なのに DB が NULL 可、は警告のみ。逆は起動失敗)
5. `primaryKey` が実際の PK と一致するか
6. `rowVersionColumn` が rowversion / timestamp 型か
7. `maxLength` が実DBの CHARACTER_MAXIMUM_LENGTH 以下か

## Go への組み込み

```go
//go:embed tables/*.yaml
var tableFS embed.FS
```

ローダは起動時に:
1. 全 YAML をパース
2. JSON Schema 相当の構造検証(go-playground/validator か cue)
3. INFORMATION_SCHEMA 突合(上記)
4. `map[string]*TableDef` としてメモリ常駐(以降ファイルは読まない)

## テーブル追加の手順

1. `meta/tables/新テーブル.yaml` を書く
2. `make validate-meta`(JSON Schema でローカル検証)
3. ビルド & デプロイ
4. 起動ログで突合成功を確認

フロントエンドは `/tables` と `/tables/{name}/meta` から動的描画するため変更不要。

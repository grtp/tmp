// アーキテクチャテスト: 内部パッケージ間の import を許可リストで凍結する。
// レイヤリングの実体は import グラフ(dev-guide §1.1)であり，新しい依存辺は
// このリストへの追記 = 意識的な設計判断としてレビューに現れるようにする。
package archtest

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const module = "f-tool/"

// allowed は「パッケージ → import してよい内部パッケージ」の全辺。
var allowed = map[string][]string{
	"cmd/server": {"gen/api", "internal/appdb", "internal/applog", "internal/audit", "internal/auth",
		"internal/authz", "internal/blobstore", "internal/config", "internal/conn",
		"internal/httpapi", "internal/meta", "internal/repo", "internal/session",
		"internal/store"},
	"internal/httpapi": {"gen/api", "internal/applog", "internal/audit", "internal/auth",
		"internal/auth/adguid", "internal/authz", "internal/conn", "internal/meta",
		"internal/predicate", "internal/repo", "internal/session", "internal/store"},
	"internal/audit": {"internal/appdb", "internal/applog", "internal/auth/adguid"},
	"internal/auth":  {"internal/auth/adguid"},
	"internal/authz": {"internal/appdb", "internal/auth", "internal/auth/adguid"},
	"internal/conn":  {"internal/appdb"},
	"internal/meta":  {"internal/appdb"},
	"internal/repo": {"internal/appdb", "internal/auth/adguid", "internal/authz",
		"internal/meta", "internal/predicate"},
	"internal/session":     {"internal/auth/adguid"},
	"internal/store":       {"internal/appdb", "internal/meta", "internal/predicate"},
	"internal/appdb":       {},
	"internal/applog":      {},
	"internal/auth/adguid": {},
	"internal/blobstore":   {},
	"internal/config":      {},
	"internal/predicate":   {},
	"internal/archtest":    {},
}

func TestImportGraph(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()

	for _, top := range []string{"internal", "cmd"} {
		err := filepath.WalkDir(filepath.Join(root, top), func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			rel, _ := filepath.Rel(root, filepath.Dir(path))
			pkg := filepath.ToSlash(rel)
			allowedSet, known := allowed[pkg]
			if !known {
				t.Errorf("未知のパッケージ %s: allowed へ追記して依存を宣言すること", pkg)
				return nil
			}
			f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, imp := range f.Imports {
				ip := strings.Trim(imp.Path.Value, `"`)
				if !strings.HasPrefix(ip, module) {
					continue
				}
				dep := strings.TrimPrefix(ip, module)
				ok := false
				for _, a := range allowedSet {
					if a == dep {
						ok = true
						break
					}
				}
				if !ok {
					t.Errorf("%s が %s を import している(許可リスト外)。\n"+
						"意図的な設計変更なら archtest の allowed へ追記する", pkg, dep)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	// 許可リスト側の腐敗防止: 実在しないパッケージが残っていないか。
	var keys []string
	for k := range allowed {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(k))); err != nil {
			t.Errorf("allowed に実在しないパッケージ %s が残っている", k)
		}
	}
}

package meta

import (
	"encoding/json"
	"fmt"
	"strings"
)

// NormalizeColumnModes は列モード指定(編集不可/除外/固定値)を検証し,
// イントロスペクション結果と突合して ftool_app_managed_tables の
// 保存形式(CSV / JSON)へ正規化する。列モードの整合性ルール
// (実在すること・主キーには指定不可・モード間の重複不可・固定値の
// 種別/値/適用タイミングの妥当性)はドメインの関心なのでここが持つ。
// 列名はカタログ上の正確な表記へ正規化される。fxJSON は '[]' = なし。
// エラー文言はそのまま API の validation_failed メッセージとして使われる。
func NormalizeColumnModes(ins *Introspection, ro, hd []string, fixed []FixedColumn) (roCSV, hdCSV, fxJSON string, err error) {
	exists := map[string]*Column{} // lower -> カタログ上の列定義
	for i := range ins.Columns {
		exists[strings.ToLower(ins.Columns[i].Name)] = &ins.Columns[i]
	}
	pkSet := map[string]struct{}{}
	for _, p := range ins.PrimaryKey {
		pkSet[strings.ToLower(p)] = struct{}{}
	}

	seen := map[string]string{} // lower -> "readonly"|"hidden"|"fixed"
	claim := func(name, mode string) (*Column, bool, error) {
		key := strings.ToLower(name)
		c, ok := exists[key]
		if !ok {
			return nil, false, fmt.Errorf("列 %q は存在しません", name)
		}
		if _, isPK := pkSet[key]; isPK {
			return nil, false, fmt.Errorf("主キー列 %q は編集不可/除外/固定値に指定できません", c.Name)
		}
		if prev, dup := seen[key]; dup {
			if prev == mode {
				return c, true, nil // 同一モードの重複は黙って畳む
			}
			// 除外+固定の併用は許可(S45): 画面からは隠しつつ,保存時に
			// サーバーが固定値を自動セットする組み合わせ。それ以外の組は不可。
			if (prev == "hidden" && mode == "fixed") || (prev == "fixed" && mode == "hidden") {
				return c, false, nil
			}
			return nil, false, fmt.Errorf("列 %q に複数のモードを同時に指定できません", c.Name)
		}
		seen[key] = mode
		return c, false, nil
	}

	normalize := func(names []string, mode string) (string, error) {
		var out []string
		for _, raw := range names {
			name := strings.TrimSpace(raw)
			if name == "" {
				continue
			}
			c, dup, err := claim(name, mode)
			if err != nil {
				return "", err
			}
			if !dup {
				out = append(out, c.Name)
			}
		}
		return strings.Join(out, ","), nil
	}

	roCSV, err = normalize(ro, "readonly")
	if err != nil {
		return "", "", "", err
	}
	hdCSV, err = normalize(hd, "hidden")
	if err != nil {
		return "", "", "", err
	}

	// 固定値指定: 種別・値・適用タイミングまで検証してから JSON 化する。
	out := []FixedColumn{}
	for _, f := range fixed {
		name := strings.TrimSpace(f.Name)
		if name == "" {
			continue
		}
		c, dup, err := claim(name, "fixed")
		if err != nil {
			return "", "", "", err
		}
		if dup {
			return "", "", "", fmt.Errorf("固定値列 %q が重複しています", c.Name)
		}
		if c.Readonly {
			return "", "", "", fmt.Errorf("列 %q は自動的に読み取り専用のため固定値を指定できません", c.Name)
		}
		mf := FixedColumn{Name: c.Name, ApplyOn: f.ApplyOn}
		switch f.Kind {
		case "literal":
			if strings.TrimSpace(f.Value) == "" {
				return "", "", "", fmt.Errorf("固定値列 %q: 値を指定してください", c.Name)
			}
			mf.Kind = "literal"
			mf.Value = f.Value
		case "now":
			if c.Type != TypeDate && c.Type != TypeDateTime && c.Type != TypeString {
				return "", "", "", fmt.Errorf("固定値列 %q: 現在時刻は日付/日時/文字列型の列にのみ指定できます", c.Name)
			}
			mf.Kind = "now"
		default:
			return "", "", "", fmt.Errorf("固定値列 %q: kind が不正です", c.Name)
		}
		switch f.ApplyOn {
		case "insert", "update", "both":
		default:
			return "", "", "", fmt.Errorf("固定値列 %q: applyOn が不正です", c.Name)
		}
		out = append(out, mf)
	}
	fxJSON = "[]"
	if len(out) > 0 {
		b, err := json.Marshal(out)
		if err != nil {
			return "", "", "", fmt.Errorf("固定値指定の変換に失敗しました: %w", err)
		}
		fxJSON = string(b)
	}
	return roCSV, hdCSV, fxJSON, nil
}

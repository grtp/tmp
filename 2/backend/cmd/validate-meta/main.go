// make validate-meta の Go 側: 埋め込みYAMLが実際にローダを通るかを
// DB なしで確認する(JSON Schema 検証と同等 + Go 構造体との整合)。
package main

import (
	"fmt"
	"log"

	"tablemaint/meta"
)

func main() {
	reg, err := meta.Load()
	if err != nil {
		log.Fatalf("validate-meta: %v", err)
	}
	for _, t := range reg.All() {
		fmt.Printf("%s: OK (%s, %d columns)\n", t.Name, t.QualifiedName(), len(t.Columns))
	}
}

package httpapi

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	stdstrings "strings"

	"tableadmin/internal/store"
)

// import is conceptually "add many": the file's rows are appended via
// BulkCreate. Format is taken from the uploaded filename's extension (.csv /
// .json), or an explicit ?format= override.
type ImportHandler struct{ store store.ProductStore }

func NewImportHandler(s store.ProductStore) *ImportHandler { return &ImportHandler{store: s} }

const maxUpload = 8 << 20 // 8 MiB

func (h *ImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		writeErr(w, http.StatusBadRequest, "ファイルのアップロードに失敗しました")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file フィールドが必要です")
		return
	}
	defer file.Close()

	format := r.URL.Query().Get("format")
	if format == "" {
		format = stdstrings.ToLower(stdstrings.TrimPrefix(path.Ext(header.Filename), "."))
	}

	var items []store.ProductInput
	switch format {
	case "csv":
		items, err = parseCSV(file)
	case "json":
		items, err = parseJSON(file)
	default:
		writeErr(w, http.StatusUnsupportedMediaType, "対応形式は csv または json です")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(items) == 0 {
		writeErr(w, http.StatusUnprocessableEntity, "取り込むデータがありません")
		return
	}

	result, err := h.store.BulkCreate(r.Context(), items)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "取り込みに失敗しました")
		return
	}
	status := http.StatusCreated
	if result.Inserted == 0 {
		status = http.StatusUnprocessableEntity // nothing committed: report errors
	}
	writeJSON(w, status, result)
}

// parseCSV reads a header row, then maps each subsequent row by column name, so
// column order in the file does not matter.
func parseCSV(r io.Reader) ([]store.ProductInput, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true

	head, err := cr.Read()
	if err != nil {
		return nil, errors.New("CSVヘッダーを読み取れません")
	}
	idx := map[string]int{}
	for i, name := range head {
		idx[stdstrings.ToLower(stdstrings.TrimSpace(name))] = i
	}
	for _, req := range []string{"code", "name"} {
		if _, ok := idx[req]; !ok {
			return nil, fmt.Errorf("CSVに必須列 %q がありません", req)
		}
	}

	var out []store.ProductInput
	for line := 2; ; line++ {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("%d行目を読み取れません: %v", line, err)
		}
		get := func(col string) string {
			if i, ok := idx[col]; ok && i < len(rec) {
				return stdstrings.TrimSpace(rec[i])
			}
			return ""
		}
		price, perr := atoiDefault(get("price"), 0)
		stock, serr := atoiDefault(get("stock"), 0)
		if perr != nil || serr != nil {
			return nil, fmt.Errorf("%d行目: price/stock は整数で指定してください", line)
		}
		out = append(out, store.ProductInput{
			Code:     get("code"),
			Name:     get("name"),
			Category: get("category"),
			Price:    price,
			Stock:    stock,
		})
	}
	return out, nil
}

func parseJSON(r io.Reader) ([]store.ProductInput, error) {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	var items []store.ProductInput
	if err := dec.Decode(&items); err != nil {
		return nil, errors.New("JSONは ProductInput の配列である必要があります")
	}
	return items, nil
}

func atoiDefault(s string, def int64) (int64, error) {
	if stdstrings.TrimSpace(s) == "" {
		return def, nil
	}
	var n int64
	_, err := fmt.Sscan(s, &n)
	return n, err
}

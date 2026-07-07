package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"tableadmin/internal/store"
)

// DefaultLimit is the page size the table shows by default (requirement: 100).
const DefaultLimit = 100
const MaxLimit = 1000

type ProductHandler struct{ store store.ProductStore }

func NewProductHandler(s store.ProductStore) *ProductHandler { return &ProductHandler{store: s} }

// List handles GET /api/products?limit&offset&q
func (h *ProductHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := clampInt(intParam(r, "limit", DefaultLimit), 1, MaxLimit)
	offset := clampInt(intParam(r, "offset", 0), 0, 1<<31)

	page, err := h.store.List(r.Context(), q, limit, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to list products")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// Create handles POST /api/products
func (h *ProductHandler) Create(w http.ResponseWriter, r *http.Request) {
	var in store.ProductInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := in.Validate(); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	p, err := h.store.Create(r.Context(), in)
	if err != nil {
		h.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// Update handles PUT /api/products/{id}
func (h *ProductHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in store.ProductInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := in.Validate(); err != nil {
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	p, err := h.store.Update(r.Context(), id, in)
	if err != nil {
		h.writeStoreErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// Delete handles DELETE /api/products/{id}
func (h *ProductHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.store.Delete(r.Context(), id); err != nil {
		h.writeStoreErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ProductHandler) writeStoreErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, store.ErrDuplicateCode):
		writeErr(w, http.StatusConflict, "コードが既に存在します")
	default:
		writeErr(w, http.StatusInternalServerError, "internal error")
	}
}

// --- param helpers ---

func pathID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func intParam(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

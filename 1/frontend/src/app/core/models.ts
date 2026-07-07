// These interfaces mirror the Go structs 1:1 (json tags === field names).
// Keeping them in one file makes the API contract explicit and greppable.

export interface User {
  username: string;
  displayName: string;
  email: string;
}

export interface Product {
  id: number;
  code: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  updatedAt: string;
}

// Writable subset for create / update / import.
export interface ProductInput {
  code: string;
  name: string;
  category: string;
  price: number;
  stock: number;
}

export interface Page {
  items: Product[];
  total: number;
}

export interface ImportError {
  row: number;
  reason: string;
}

export interface ImportResult {
  inserted: number;
  failed: ImportError[];
}

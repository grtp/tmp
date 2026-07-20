// Package blobstore は S3 互換オブジェクトストレージ(MinIO)への薄いラッパー。
//
// 現状の用途は監査履歴(app_operation_history.detail)の 1MB 超過分の退避
// (claim check パターン)のみ。ブラウザには直接触らせず，必ず backend が
// サーバーサイドで Put/Get する(MinIO はネットワーク的に内部限定のまま)。
//
// 単一ノード MinIO は冗長性を持たない。書き込み失敗時の扱いは呼び出し側
// (internal/audit)が best-effort で判断する(ここでは単にエラーを返すのみ)。
package blobstore

import (
	"bytes"
	"context"
	"fmt"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type Store struct {
	client *minio.Client
	bucket string
}

// New は MinIO に接続し，対象バケットが無ければ作成する。
func New(ctx context.Context, endpoint, accessKey, secretKey, bucket string, useSSL bool) (*Store, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("blobstore: connect: %w", err)
	}

	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("blobstore: check bucket: %w", err)
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, fmt.Errorf("blobstore: create bucket: %w", err)
		}
	}
	return &Store{client: client, bucket: bucket}, nil
}

// Put stores an object under key(例 "audit-overflow/<uuid>.json")。
func (s *Store) Put(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(data), int64(len(data)),
		minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return fmt.Errorf("blobstore: put %s: %w", key, err)
	}
	return nil
}

func (s *Store) Get(ctx context.Context, key string) ([]byte, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("blobstore: get %s: %w", key, err)
	}
	defer obj.Close()

	buf := new(bytes.Buffer)
	if _, err := buf.ReadFrom(obj); err != nil {
		return nil, fmt.Errorf("blobstore: read %s: %w", key, err)
	}
	return buf.Bytes(), nil
}

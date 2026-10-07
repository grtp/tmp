package pwchange

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type Lockout struct {
	rdb            *redis.Client
	alertThreshold int
	alertWindow    time.Duration
}

func NewLockout(rdb *redis.Client, alertThreshold int, alertWindow time.Duration) *Lockout {
	if alertThreshold <= 0 {
		alertThreshold = 20
	}
	if alertWindow <= 0 {
		alertWindow = 10 * time.Minute
	}
	return &Lockout{rdb: rdb, alertThreshold: alertThreshold, alertWindow: alertWindow}
}

func failKey(target int, subject string) string {
	return fmt.Sprintf("pwc:fail:%d:%s", target, subject)
}
func lockKey(target int, subject string) string {
	return fmt.Sprintf("pwc:lock:%d:%s", target, subject)
}
func targetFailKey(target int) string  { return fmt.Sprintf("pwc:tfail:%d", target) }
func targetAlertKey(target int) string { return fmt.Sprintf("pwc:alert:%d", target) }

func (l *Lockout) Status(ctx context.Context, target int, subject string) (locked bool, retryAfter time.Duration, err error) {
	ttl, err := l.rdb.TTL(ctx, lockKey(target, subject)).Result()
	if err != nil {
		return false, 0, fmt.Errorf("lockout: status: %w", err)
	}

	if ttl <= 0 {
		return false, 0, nil
	}
	return true, ttl, nil
}

type FailureResult struct {
	Locked bool

	Remaining int

	Alert bool

	TargetFailures int
}

func (l *Lockout) RecordFailure(ctx context.Context, target int, subject string, maxFailures int, lockFor time.Duration) (*FailureResult, error) {
	if maxFailures <= 0 {
		maxFailures = 5
	}
	if lockFor <= 0 {
		lockFor = 15 * time.Minute
	}
	fk := failKey(target, subject)
	n, err := l.rdb.Incr(ctx, fk).Result()
	if err != nil {
		return nil, fmt.Errorf("lockout: incr: %w", err)
	}
	if n == 1 {

		_ = l.rdb.Expire(ctx, fk, lockFor).Err()
	}
	res := &FailureResult{Remaining: maxFailures - int(n)}
	if res.Remaining <= 0 {
		res.Remaining = 0
		res.Locked = true
		pipe := l.rdb.TxPipeline()
		pipe.Set(ctx, lockKey(target, subject), "1", lockFor)
		pipe.Del(ctx, fk)
		if _, err := pipe.Exec(ctx); err != nil {
			return nil, fmt.Errorf("lockout: lock: %w", err)
		}
	}

	tk := targetFailKey(target)
	tn, err := l.rdb.Incr(ctx, tk).Result()
	if err != nil {
		return nil, fmt.Errorf("lockout: target incr: %w", err)
	}
	if tn == 1 {
		_ = l.rdb.Expire(ctx, tk, l.alertWindow).Err()
	}
	res.TargetFailures = int(tn)
	if int(tn) > l.alertThreshold {

		first, err := l.rdb.SetNX(ctx, targetAlertKey(target), "1", l.alertWindow).Result()
		if err != nil {
			return nil, fmt.Errorf("lockout: alert: %w", err)
		}
		res.Alert = first
	}
	return res, nil
}

func (l *Lockout) Reset(ctx context.Context, target int, subject string) error {
	if err := l.rdb.Del(ctx, failKey(target, subject)).Err(); err != nil {
		return fmt.Errorf("lockout: reset: %w", err)
	}
	return nil
}

func (l *Lockout) TargetFailures(ctx context.Context, target int) (int, error) {
	n, err := l.rdb.Get(ctx, targetFailKey(target)).Int()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("lockout: target failures: %w", err)
	}
	return n, nil
}

func (l *Lockout) AlertThreshold() int { return l.alertThreshold }

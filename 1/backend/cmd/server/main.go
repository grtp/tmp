package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tableadmin/internal/auth"
	"tableadmin/internal/config"
	"tableadmin/internal/httpapi"
	"tableadmin/internal/store"
)

func main() {
	cfg := config.FromEnv()

	st, err := store.NewSQLiteStore(cfg.DBPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	var authenticator auth.Authenticator
	if true {
		log.Println("⚠️  LDAP_MOCK=true: using mock authenticator (dev only)")
		authenticator = &auth.MockAuthenticator{
			Username: cfg.LDAPMockUser,
			Password: cfg.LDAPMockPass,
		}
	} else {
		authenticator = auth.NewLDAPAuthenticator(auth.LDAPConfig{
			URL:          cfg.LDAPURL,
			BaseDN:       cfg.LDAPBaseDN,
			UserFilter:   cfg.LDAPUserFilter,
			BindDN:       cfg.LDAPBindDN,
			BindPassword: cfg.LDAPBindPassword,
			StartTLS:     cfg.LDAPStartTLS,
		})
	}
	tokens := auth.NewTokenManager(
		cfg.JWTSecret,
		time.Duration(cfg.TokenTTLMin)*time.Minute,
		cfg.CookieName,
		cfg.CookieSecure,
	)

	handler := httpapi.Router(
		httpapi.NewAuthHandler(authenticator, tokens),
		httpapi.NewProductHandler(st),
		httpapi.NewImportHandler(st),
		tokens,
		cfg.CORSOrigin,
	)

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// Graceful shutdown on SIGINT/SIGTERM.
	go func() {
		log.Printf("listening on %s", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
	log.Println("bye")
}

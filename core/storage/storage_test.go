package storage

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestRejectFutureDatabaseBeforeMigration(t *testing.T) {
	p := filepath.Join(t.TempDir(), "zero.db")
	db, e := sql.Open("sqlite", p)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec("CREATE TABLE migrations(version INTEGER PRIMARY KEY); INSERT INTO migrations VALUES(999)")
	if e != nil {
		t.Fatal(e)
	}
	db.Close()
	opened, e := Open(p)
	if e == nil {
		opened.Close()
		t.Fatal("opened future database")
	}
	db, _ = sql.Open("sqlite", p)
	defer db.Close()
	var n int
	db.QueryRow("SELECT count(*) FROM migrations").Scan(&n)
	if n != 1 {
		t.Fatal("modified future schema")
	}
}

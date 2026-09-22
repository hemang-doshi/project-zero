package storage

import (
	"database/sql"
	"fmt"
	"os"
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

func TestCheckpointTruncatesWriteAheadLog(t *testing.T) {
	p := filepath.Join(t.TempDir(), "zero.db")
	db, e := Open(p)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	tx, e := db.Begin()
	if e != nil {
		t.Fatal(e)
	}
	blob := make([]byte, 2048)
	for i := 0; i < 4000; i++ {
		if _, e = tx.Exec("INSERT INTO events(id,kind,data,time) VALUES(?,?,?,?)", fmt.Sprint("e", i), "k", blob, "t"); e != nil {
			t.Fatal(e)
		}
	}
	if e = tx.Commit(); e != nil {
		t.Fatal(e)
	}
	wal := p + "-wal"
	before, e := os.Stat(wal)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); e != nil {
		t.Fatal(e)
	}
	after, e := os.Stat(wal)
	if e != nil {
		t.Fatal(e)
	}
	if after.Size() >= before.Size() {
		t.Fatalf("WAL not truncated: before=%d after=%d", before.Size(), after.Size())
	}
}

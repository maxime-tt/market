package relay_test

import (
	"encoding/hex"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/nbd-wtf/go-nostr"

	"github.com/maximotodev/plebeian-auctions-poc/internal/poc"
)

// TestAppSignerAgreesWithGoNostr proves the application's own event signer and
// go-nostr compute the SAME event id and signature for the same key, timestamp,
// kind, tag order and content.  The relay carries events between the two, and
// nak verifies ids with the NIP-01 rule, so a disagreement here would mean
// events signed by one side are rejected by the other.
func TestAppSignerAgreesWithGoNostr(t *testing.T) {
	raw := make([]byte, 32)
	raw[31] = 0x42
	key, _ := btcec.PrivKeyFromBytes(raw)
	secret := hex.EncodeToString(raw)
	content := `{"auction_id":"agree","title":"x"}`
	tags := [][]string{{"t", "agree"}}

	appEvent, err := poc.SignNostrEvent(key, 1_700_000_000, poc.KindCreate, tags, content)
	if err != nil {
		t.Fatalf("app sign: %v", err)
	}

	libEvent := nostr.Event{Kind: poc.KindCreate, CreatedAt: 1_700_000_000, Content: content, Tags: nostr.Tags{tags[0]}}
	if err := libEvent.Sign(secret); err != nil {
		t.Fatalf("go-nostr sign: %v", err)
	}
	if libEvent.ID != appEvent.ID {
		t.Fatalf("event id mismatch:\n app  = %s\n nostr= %s", appEvent.ID, libEvent.ID)
	}
	if libEvent.Sig != appEvent.Sig {
		t.Fatalf("signature mismatch:\n app  = %s\n nostr= %s", appEvent.Sig, libEvent.Sig)
	}
	if _, err := poc.VerifyNostrEvent(poc.SignedEvent{ID: libEvent.ID, PubKey: libEvent.PubKey, CreatedAt: int64(libEvent.CreatedAt), Kind: libEvent.Kind, Tags: tags, Content: libEvent.Content, Sig: libEvent.Sig}); err != nil {
		t.Fatalf("go-nostr-signed event failed app verification: %v", err)
	}
}

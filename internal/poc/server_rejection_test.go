package poc

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	jsonrpctypes "github.com/cometbft/cometbft/rpc/jsonrpc/types"
)

// A deterministic CheckTx rejection must reach the caller as the application's
// own reason with a 422, not as an opaque transport failure.  Before this
// classifier existed, every business rejection -- a late bid, a bid below the
// minimum, an auction that had not ended yet -- was reported as
// 503 "consensus transaction outcome unavailable", which reads as an outage.
func TestApplicationRejectionIsClassifiedFromTheLiveCometBFTErrorShape(t *testing.T) {
	t.Parallel()

	// Byte-for-byte the body a real CometBFT v1.0.0 node returns for
	// broadcast_tx_commit when CheckTx refuses the transaction.  Captured from
	// a live four-validator local network.
	raw := []byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error",` +
		`"data":"broadcast error on transaction validation: tx CD18F331C497941FC2004F12019DB0F1` +
		`087ECEC9B3B69048767D3DA9EF0F8B99 is invalid: code=1, data=, log='auction is not open', ` +
		`codespace='plebeian-auctions-poc'"}}`)
	var response jsonrpctypes.RPCResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatalf("decode captured RPC body: %v", err)
	}
	if response.Error == nil {
		t.Fatal("captured body did not decode to an RPC error")
	}

	// The HTTP client hands back *RPCError.  A value target silently fails
	// errors.As for a pointer error, which would reintroduce the bug.
	var asPointer error = response.Error
	log, ok := applicationRejectionLog(asPointer)
	if !ok {
		t.Fatal("a real CheckTx rejection was not classified as an application verdict")
	}
	if log != "auction is not open" {
		t.Fatalf("classified log = %q, want the application's own reason", log)
	}

	var asValue error = *response.Error
	if valueLog, valueOK := applicationRejectionLog(asValue); !valueOK || valueLog != "auction is not open" {
		t.Fatalf("value-form error classified ok=%v log=%q, want ok=true with the same reason", valueOK, valueLog)
	}
}

// Every error that is not an explicit application verdict must stay a transport
// failure, so the site never tells a user their bid was rejected when the
// consensus path was merely unavailable.
func TestTransportShapedErrorsAreNeverClassifiedAsApplicationRejections(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		err  error
	}{
		{"plain connection error", errors.New("dial tcp 127.0.0.1:26657: connect: connection refused")},
		{"timeout", fmt.Errorf("context deadline exceeded")},
		{"rpc error without the validation marker", &jsonrpctypes.RPCError{
			Code: -32603, Message: "Internal error", Data: "something else went wrong",
		}},
		{"rpc error with an empty body", &jsonrpctypes.RPCError{Code: -32603, Message: "Internal error"}},
		{"rpc error carrying only the marker with no detail", &jsonrpctypes.RPCError{
			Code: -32603, Message: "Internal error", Data: applicationRejectionLogMarker,
		}},
	}
	for _, testCase := range cases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if log, ok := applicationRejectionLog(testCase.err); ok {
				t.Fatalf("transport-shaped error was classified as a rejection: log=%q", log)
			}
		})
	}

	// A nil error must not be classified either.
	if log, ok := applicationRejectionLog(nil); ok {
		t.Fatalf("nil error was classified as a rejection: log=%q", log)
	}
}

// The classifier must degrade to the full detail rather than an empty reason if
// a future node drops the log='...' quoting, so the caller still sees something
// actionable.
func TestApplicationRejectionFallsBackToFullDetailWithoutQuotedLog(t *testing.T) {
	t.Parallel()

	detail := applicationRejectionLogMarker + " tx ABC is invalid: code=1"
	log, ok := applicationRejectionLog(&jsonrpctypes.RPCError{Code: -32603, Data: detail})
	if !ok {
		t.Fatal("marker-bearing detail was not classified")
	}
	if !strings.Contains(log, "code=1") {
		t.Fatalf("fallback log = %q, want it to retain the detail", log)
	}
}

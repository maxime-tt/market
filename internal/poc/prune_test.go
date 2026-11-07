package poc

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cometbft/cometbft/rpc/grpc/client/privileged"
)

func TestBlocksForRetention(t *testing.T) {
	cases := []struct {
		window time.Duration
		want   int64
	}{
		{0, 0},
		{-time.Hour, 0},
		{time.Second, 1},
		{24 * time.Hour, 86400},
		{90 * time.Minute, 5400},
	}
	for _, tc := range cases {
		if got := blocksForRetention(tc.window); got != tc.want {
			t.Fatalf("blocksForRetention(%s) = %d, want %d", tc.window, got, tc.want)
		}
	}
}

func TestRetainHeightFor(t *testing.T) {
	cases := []struct {
		name    string
		current int64
		retain  int64
		want    int64
	}{
		{"no head", 0, 86400, 0},
		{"disabled", 100000, 0, 0},
		{"negative window", 100000, -5, 0},
		{"24h at 1s", 200000, 86400, 113600},
		{"young chain keeps everything", 500, 86400, 0},
		{"floor wins over tiny window", 5000, 10, 4000},
		{"floor is a count, not a height", 1001, 1, 1},
		{"never returns the head", 1000, 1, 0},
		{"never above head", 1001, 1, 1},
	}
	for _, tc := range cases {
		got := retainHeightFor(tc.current, tc.retain)
		if got != tc.want {
			t.Fatalf("%s: retainHeightFor(%d, %d) = %d, want %d", tc.name, tc.current, tc.retain, got, tc.want)
		}
		if got > tc.current {
			t.Fatalf("%s: retain height %d is above head %d", tc.name, got, tc.current)
		}
	}
}

func TestPrunePolicyFromEnv(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}
	policy, err := prunePolicyFromEnv(env(nil))
	if err != nil || !policy.enabled || policy.retainBlocks != 86400 {
		t.Fatalf("default policy = %+v, %v; want enabled 86400", policy, err)
	}
	policy, err = prunePolicyFromEnv(env(map[string]string{"POC_PRUNE_RETENTION_HOURS": "6"}))
	if err != nil || !policy.enabled || policy.retainBlocks != 21600 {
		t.Fatalf("6h policy = %+v, %v; want enabled 21600", policy, err)
	}
	policy, err = prunePolicyFromEnv(env(map[string]string{"POC_RETAIN_BLOCKS": "5000"}))
	if err != nil || !policy.enabled || policy.retainBlocks != 5000 {
		t.Fatalf("explicit blocks = %+v, %v; want enabled 5000", policy, err)
	}
	policy, err = prunePolicyFromEnv(env(map[string]string{"POC_RETAIN_BLOCKS": "0"}))
	if err != nil || policy.enabled {
		t.Fatalf("POC_RETAIN_BLOCKS=0 = %+v, %v; want disabled", policy, err)
	}
	policy, err = prunePolicyFromEnv(env(map[string]string{"POC_PRUNE_RETENTION_HOURS": "0"}))
	if err != nil || policy.enabled {
		t.Fatalf("POC_PRUNE_RETENTION_HOURS=0 = %+v, %v; want disabled", policy, err)
	}
	if _, err := prunePolicyFromEnv(env(map[string]string{"POC_RETAIN_BLOCKS": "-1"})); err == nil {
		t.Fatal("negative POC_RETAIN_BLOCKS was accepted")
	}
	if _, err := prunePolicyFromEnv(env(map[string]string{"POC_PRUNE_RETENTION_HOURS": "soon"})); err == nil {
		t.Fatal("non-numeric POC_PRUNE_RETENTION_HOURS was accepted")
	}
}

func TestValidatorConfigEnablesOnlyPruningServiceOnLoopback(t *testing.T) {
	root := t.TempDir()
	manifest := NetworkManifest{
		ChainID: "test-chain",
		Validators: []ValidatorManifest{{
			Slot:       1,
			Moniker:    "poc-validator-1",
			P2PListen:  "tcp://127.0.0.1:28656",
			RPCListen:  "tcp://127.0.0.1:28657",
			GRPCListen: "tcp://127.0.0.1:28658",
		}},
	}
	config := validatorConfig(root, filepath.Join(root, "validator-1"), manifest, manifest.Validators[0])
	if config.GRPC.ListenAddress != "" {
		t.Fatalf("public gRPC listener = %q, want disabled", config.GRPC.ListenAddress)
	}
	if config.GRPC.Privileged.ListenAddress != "tcp://127.0.0.1:28658" {
		t.Fatalf("privileged listener = %q, want loopback 28658", config.GRPC.Privileged.ListenAddress)
	}
	if !strings.HasPrefix(config.GRPC.Privileged.ListenAddress, "tcp://127.0.0.1:") {
		t.Fatalf("privileged listener %q is not loopback", config.GRPC.Privileged.ListenAddress)
	}
	if !config.GRPC.Privileged.PruningService.Enabled {
		t.Fatal("pruning service is not enabled")
	}
	if config.GRPC.VersionService.Enabled || config.GRPC.BlockService.Enabled || config.GRPC.BlockResultsService.Enabled {
		t.Fatal("a non-pruning gRPC service is enabled")
	}
	if !config.Storage.Pruning.DataCompanion.Enabled {
		t.Fatal("data companion pruning is not enabled; the companion retain height would be ignored")
	}
	if config.Consensus.CreateEmptyBlocksInterval != time.Second {
		t.Fatalf("empty-block interval = %s, want the owner's 1s", config.Consensus.CreateEmptyBlocksInterval)
	}

	// Remote networks carry no GRPCListen and must keep the privileged server
	// disabled, exactly as before this slice.
	manifest.Mode = "remote"
	manifest.Validators[0].GRPCListen = ""
	config = validatorConfig(root, filepath.Join(root, "validator-1"), manifest, manifest.Validators[0])
	if config.GRPC.Privileged.ListenAddress != "" || config.GRPC.Privileged.PruningService.Enabled {
		t.Fatal("privileged gRPC server is enabled without a loopback listener")
	}
	if config.Storage.Pruning.DataCompanion.Enabled {
		t.Fatal("data companion pruning is enabled without a privileged listener")
	}
}

func TestLocalGRPCListenBackfillsLegacyLocalManifest(t *testing.T) {
	manifest := NetworkManifest{Validators: []ValidatorManifest{{Slot: 2}}}
	if got := localGRPCListen(manifest, manifest.Validators[0]); got != "tcp://127.0.0.1:28758" {
		t.Fatalf("backfilled listener = %q, want slot 2 loopback 28758", got)
	}
	manifest.Validators[0].GRPCListen = "tcp://127.0.0.1:40000"
	if got := localGRPCListen(manifest, manifest.Validators[0]); got != "tcp://127.0.0.1:40000" {
		t.Fatalf("explicit listener = %q, want the manifest value", got)
	}
	manifest.Mode = "remote"
	manifest.Validators[0].GRPCListen = ""
	if got := localGRPCListen(manifest, manifest.Validators[0]); got != "" {
		t.Fatalf("remote listener = %q, want disabled", got)
	}
}

type fakePruningClient struct {
	retain    uint64
	setCalls  []uint64
	setErr    error
	getErr    error
	closeCall bool
}

func (f *fakePruningClient) SetBlockRetainHeight(_ context.Context, height uint64) error {
	f.setCalls = append(f.setCalls, height)
	if f.setErr != nil {
		return f.setErr
	}
	f.retain = height
	return nil
}

func (f *fakePruningClient) GetBlockRetainHeight(context.Context) (privileged.RetainHeights, error) {
	if f.getErr != nil {
		return privileged.RetainHeights{}, f.getErr
	}
	return privileged.RetainHeights{PruningService: f.retain}, nil
}

func (f *fakePruningClient) Close() error {
	f.closeCall = true
	return nil
}

func TestPrunerSetsRetainHeightAndFailsSoft(t *testing.T) {
	validator := ValidatorManifest{Slot: 1, RPCListen: "tcp://127.0.0.1:28657", GRPCListen: "tcp://127.0.0.1:28658"}
	policy := prunePolicy{enabled: true, retainBlocks: 86400}
	pruner := newBlockPruner(policy)
	pruner.logf = func(string, ...any) {}
	pruner.height = func(context.Context, string) (int64, error) { return 200000, nil }

	client := &fakePruningClient{}
	pruner.pruneOnce(context.Background(), validator, client)
	if len(client.setCalls) != 1 || client.setCalls[0] != 113600 {
		t.Fatalf("set calls = %v, want [113600]", client.setCalls)
	}

	// Already at or above the target: no second call.
	pruner.pruneOnce(context.Background(), validator, client)
	if len(client.setCalls) != 1 {
		t.Fatalf("set calls = %v, want no repeat", client.setCalls)
	}

	// A failing height read or set must not panic or retry within the tick.
	pruner.height = func(context.Context, string) (int64, error) { return 0, errors.New("rpc down") }
	pruner.pruneOnce(context.Background(), validator, client)
	if len(client.setCalls) != 1 {
		t.Fatalf("set calls = %v after height failure, want unchanged", client.setCalls)
	}

	pruner.height = func(context.Context, string) (int64, error) { return 300000, nil }
	client.setErr = errors.New("grpc unavailable")
	pruner.pruneOnce(context.Background(), validator, client)
	if len(client.setCalls) != 2 {
		t.Fatalf("set calls = %v, want a second attempt that fails soft", client.setCalls)
	}
}

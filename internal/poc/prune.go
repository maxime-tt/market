package poc

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	"github.com/cometbft/cometbft/rpc/grpc/client/privileged"
)

const (
	// blockInterval is the consensus empty-block interval.  The owner's ruling
	// keeps it at one second: with bids arriving close together the chain's job
	// is fine-grained ordering, so retention is the only lever in this slice.
	blockInterval = time.Second

	defaultPruneRetentionHours = 24

	// pruneFloorBlocks is the hard minimum number of recent blocks kept even
	// when an operator configures a shorter window.  The application reads only
	// the latest commit, but a floor keeps the RPC's height-1 commit lookup,
	// peer catch-up and manual inspection working, and bounds the blast radius
	// of a mistyped retention value.  1000 blocks is ~17 minutes at 1s.
	pruneFloorBlocks int64 = 1000

	// pruneInterval is how often the pruner re-evaluates the head.  CometBFT's
	// own pruning loop runs every 10s; 30s is frequent enough to keep the
	// blockstore bounded without adding RPC chatter.
	pruneInterval = 30 * time.Second
)

// prunePolicy is the resolved retention window.  A disabled policy means the
// node keeps every block, which is the pre-slice behaviour.
type prunePolicy struct {
	enabled      bool
	retainBlocks int64
}

// prunePolicyFromEnv resolves the retention window.  POC_RETAIN_BLOCKS wins
// over POC_PRUNE_RETENTION_HOURS when both are set; 0 disables pruning.
func prunePolicyFromEnv(getenv func(string) string) (prunePolicy, error) {
	if raw := strings.TrimSpace(getenv("POC_RETAIN_BLOCKS")); raw != "" {
		blocks, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || blocks < 0 {
			return prunePolicy{}, errors.New("POC_RETAIN_BLOCKS must be a non-negative integer")
		}
		if blocks == 0 {
			return prunePolicy{}, nil
		}
		return prunePolicy{enabled: true, retainBlocks: blocks}, nil
	}
	hours := float64(defaultPruneRetentionHours)
	if raw := strings.TrimSpace(getenv("POC_PRUNE_RETENTION_HOURS")); raw != "" {
		parsed, err := strconv.ParseFloat(raw, 64)
		if err != nil || parsed < 0 {
			return prunePolicy{}, errors.New("POC_PRUNE_RETENTION_HOURS must be a non-negative number")
		}
		hours = parsed
	}
	if hours == 0 {
		return prunePolicy{}, nil
	}
	return prunePolicy{enabled: true, retainBlocks: blocksForRetention(time.Duration(hours * float64(time.Hour)))}, nil
}

// blocksForRetention converts a wall-clock window into a block count at the
// fixed 1s block interval.
func blocksForRetention(window time.Duration) int64 {
	if window <= 0 {
		return 0
	}
	return int64(window / blockInterval)
}

// retainHeightFor returns the height below which block data may be pruned.
// It never returns a height above the current head, never returns the head
// itself (the latest block must stay readable), and never keeps fewer than
// pruneFloorBlocks recent blocks.  A zero result means "do not prune".
func retainHeightFor(current, retainBlocks int64) int64 {
	if current <= 0 || retainBlocks <= 0 {
		return 0
	}
	keep := retainBlocks
	if keep < pruneFloorBlocks {
		keep = pruneFloorBlocks
	}
	target := current - keep
	if target < 1 {
		return 0
	}
	if target >= current {
		target = current - 1
	}
	return target
}

// pruningClient is the slice of the privileged gRPC client the pruner needs.
type pruningClient interface {
	SetBlockRetainHeight(ctx context.Context, height uint64) error
	GetBlockRetainHeight(ctx context.Context) (privileged.RetainHeights, error)
	Close() error
}

type blockPruner struct {
	policy   prunePolicy
	interval time.Duration
	logf     func(format string, args ...any)
	dial     func(ctx context.Context, address string) (pruningClient, error)
	height   func(ctx context.Context, rpcAddress string) (int64, error)
}

func newBlockPruner(policy prunePolicy) *blockPruner {
	return &blockPruner{
		policy:   policy,
		interval: pruneInterval,
		logf: func(format string, args ...any) {
			fmt.Fprintf(os.Stdout, format+"\n", args...)
		},
		dial: func(ctx context.Context, address string) (pruningClient, error) {
			return privileged.New(ctx, address, privileged.WithInsecure(), privileged.WithPruningServiceEnabled(true))
		},
		height: rpcHeight,
	}
}

// run starts one goroutine per validator that exposes a privileged gRPC
// listener.  It returns immediately; every error is logged and retried on the
// next tick so a pruning failure can never disturb consensus.
func (p *blockPruner) run(ctx context.Context, manifest NetworkManifest) {
	if !p.policy.enabled {
		return
	}
	for _, validator := range manifest.Validators {
		address := localGRPCListen(manifest, validator)
		if address == "" {
			continue
		}
		go p.runValidator(ctx, validator, address)
	}
}

func (p *blockPruner) runValidator(ctx context.Context, validator ValidatorManifest, address string) {
	client, err := p.dial(ctx, strings.TrimPrefix(address, "tcp://"))
	if err != nil {
		p.logf("prune: validator %d: dial %s: %v", validator.Slot, address, err)
		return
	}
	defer client.Close()
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		p.pruneOnce(ctx, validator, client)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (p *blockPruner) pruneOnce(ctx context.Context, validator ValidatorManifest, client pruningClient) {
	height, err := p.height(ctx, validator.RPCListen)
	if err != nil {
		p.logf("prune: validator %d: read height: %v", validator.Slot, err)
		return
	}
	target := retainHeightFor(height, p.policy.retainBlocks)
	if target <= 0 {
		return
	}
	// The companion retain height can only move up.  Skipping when it is
	// already at or above the target avoids a permanent error loop after a
	// restart, when the stored height is ahead of a freshly computed one.
	if current, err := client.GetBlockRetainHeight(ctx); err == nil && target <= int64(current.PruningService) {
		return
	}
	if err := client.SetBlockRetainHeight(ctx, uint64(target)); err != nil {
		p.logf("prune: validator %d: set retain height %d: %v", validator.Slot, target, err)
		return
	}
	p.logf("prune: validator %d: retain height %d (head %d, window %d blocks)", validator.Slot, target, height, p.policy.retainBlocks)
}

func rpcHeight(ctx context.Context, rpcAddress string) (int64, error) {
	client, err := rpchttp.New("http://" + strings.TrimPrefix(rpcAddress, "tcp://"))
	if err != nil {
		return 0, err
	}
	status, err := client.Status(ctx)
	if err != nil {
		return 0, err
	}
	return status.SyncInfo.LatestBlockHeight, nil
}

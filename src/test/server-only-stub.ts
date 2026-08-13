/**
 * vitest 用の `server-only` スタブ (vitest.config.ts の alias から参照)。
 *
 * `server-only` の実体は import されるだけで throw する番兵で、Client
 * Component から誤って読み込むのを防ぐためのもの。vitest は node 環境で
 * `react-server` の export condition を解決しないため実体側 (throw する方) に
 * 落ち、`server-only` を import している module はテストできなくなる。
 *
 * 番兵の効果は本番ビルド (Next の bundler) で担保されるので、テスト時だけ
 * 無害な空 module に差し替える。
 */
export {};

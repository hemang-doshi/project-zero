import ZeroKit

/// Revision-keyed memoization for route projections (Task 1).
///
/// Shell route switches (`CockpitRouteContent`) rebuild the newly visible
/// route's projection on every switch, and the route views re-derive their
/// facts on every body evaluation. With an unchanged snapshot revision (and
/// unchanged connections/store), that work is pure redundancy: identical
/// inputs always produce identical facts. This cache holds the last
/// `(key, facts)` pair per route and returns the stored value when the key
/// matches, so a route switch with unchanged state does zero rebuild work.
/// Any revision, connection, or store change rebuilds exactly once.
///
/// Route switches never refetch: callers pass the already-held
/// `model.snapshot` through, and no path here touches the network.
///
/// Views use the shared instance; tests use fresh instances for isolation.
@MainActor
final class ProjectionCache {
    static let shared = ProjectionCache()

    private var network: (revision: UInt64?, connection: RuntimeConnectionState, facts: NetworkFacts)?
    private var flight: (revision: UInt64?, runtimeConnection: RuntimeConnectionState,
                         codexConnection: CodexConnectionState, store: CodexEventStore,
                         projection: FlightProjection)?

    func networkFacts(snapshot: CockpitSnapshot?, connection: RuntimeConnectionState) -> NetworkFacts {
        if let cached = network, cached.revision == snapshot?.revision, cached.connection == connection {
            return cached.facts
        }
        let facts = NetworkFacts(snapshot: snapshot, connection: connection)
        network = (snapshot?.revision, connection, facts)
        return facts
    }

    func flightProjection(snapshot: CockpitSnapshot?, runtimeConnection: RuntimeConnectionState,
                          codexStore: CodexEventStore, codexConnection: CodexConnectionState) -> FlightProjection {
        if let cached = flight,
           cached.revision == snapshot?.revision,
           cached.runtimeConnection == runtimeConnection,
           cached.codexConnection == codexConnection,
           cached.store == codexStore {
            return cached.projection
        }
        let projection = FlightProjection(snapshot: snapshot, runtimeConnection: runtimeConnection,
                                          codexStore: codexStore, codexConnection: codexConnection)
        flight = (snapshot?.revision, runtimeConnection, codexConnection, codexStore, projection)
        return projection
    }

    /// Test hook: drop all retained projections.
    func invalidate() {
        network = nil
        flight = nil
    }
}

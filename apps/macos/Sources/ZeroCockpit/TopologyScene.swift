import Foundation
import SwiftUI
import ZeroKit
#if canImport(SceneKit)
import SceneKit
#endif

enum TopologyKind: Equatable { case core, macbook, display, phone, upcoming }
struct TopologyNode: Identifiable, Equatable {
    let id: String; let kind: TopologyKind; let status: String
}
func buildTopologyNodes(snapshotNodes: [CockpitNode]) -> [TopologyNode] {
    var out = [TopologyNode(id: "zero-core", kind: .core, status: "ONLINE")]
    for node in snapshotNodes where !node.revoked {
        if node.capabilities.contains("display.render") { out.append(.init(id: node.id, kind: .display, status: node.status)) }
        else { out.append(.init(id: node.id, kind: .macbook, status: node.status)) }
    }
    out.append(.init(id: "phone-upcoming", kind: .upcoming, status: "UPCOMING"))
    return out
}
func gatedUpcomingCount(_ nodes: [TopologyNode]) -> Int { nodes.filter { $0.kind == .upcoming }.count }

/// Native SceneKit topology. All geometry is drawn locally from the bounded
/// snapshot projection; no daemon, WebKit, or network fetch is involved.
struct TopologySceneView: View {
    let nodes: [TopologyNode]

    var upcoming: [TopologyNode] { nodes.filter { $0.kind == .upcoming } }

    var body: some View {
        ZStack(alignment: .topTrailing) {
#if canImport(SceneKit)
            TopologySCNView(nodes: nodes)
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Spatial topology, \(nodes.count) nodes")
                .accessibilityValue(accessibilitySummary)
#else
            TopologyFallbackList(nodes: nodes)
                .frame(maxWidth: .infinity)
#endif
            if !upcoming.isEmpty {
                Text("GATED — UPCOMING")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(ZeroTheme.secondaryInk)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 5))
                    .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(ZeroTheme.line))
                    .padding(8)
                    .allowsHitTesting(false)
                    .accessibilityLabel("Upcoming devices are gated")
            }
        }
    }

    private var accessibilitySummary: String {
        let live = nodes.filter { $0.kind != .upcoming }.map(\.id).joined(separator: ", ")
        return "Live: \(live.isEmpty ? "core only" : live). Upcoming gated: \(upcoming.map(\.id).joined(separator: ", "))"
    }
}

/// 2D list fallback when SceneKit is unavailable. Upcoming rows are dimmed
/// and non-interactive behind the GATED overlay owned by `TopologySceneView`.
struct TopologyFallbackList: View {
    let nodes: [TopologyNode]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(nodes) { node in
                HStack(spacing: 8) {
                    Image(systemName: symbol(for: node.kind))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                    Text(node.id)
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                    Spacer()
                    Text(node.status)
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundStyle(ZeroTheme.secondaryInk)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(ZeroTheme.navigation.opacity(0.45), in: RoundedRectangle(cornerRadius: 6))
                .opacity(node.kind == .upcoming ? 0.45 : 1.0)
                .allowsHitTesting(node.kind != .upcoming)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Node \(node.id), \(node.status)\(node.kind == .upcoming ? ", gated upcoming" : "")")
            }
        }
    }

    private func symbol(for kind: TopologyKind) -> String {
        switch kind {
        case .core: "desktopcomputer"
        case .macbook: "laptopcomputer"
        case .display: "display"
        case .phone: "iphone"
        case .upcoming: "lock.shield"
        }
    }
}

#if canImport(SceneKit)
private struct TopologySCNView: NSViewRepresentable {
    let nodes: [TopologyNode]

    func makeNSView(context: Context) -> SCNView {
        let view = SCNView()
        view.scene = TopologySceneBuilder.scene(nodes: nodes)
        view.allowsCameraControl = false
        view.autoenablesDefaultLighting = true
        view.backgroundColor = .clear
        return view
    }

    func updateNSView(_ view: SCNView, context: Context) {
        view.scene = TopologySceneBuilder.scene(nodes: nodes)
        view.allowsCameraControl = false
    }
}

private enum TopologySceneBuilder {
    static func scene(nodes: [TopologyNode]) -> SCNScene {
        let scene = SCNScene()
        let cameraNode = SCNNode()
        cameraNode.camera = SCNCamera()
        cameraNode.position = SCNVector3(0, 1.2, 8.5)
        cameraNode.look(at: SCNVector3(0, 0, 0))
        scene.rootNode.addChildNode(cameraNode)

        let live = nodes.filter { $0.kind != .upcoming }
        let upcoming = nodes.filter { $0.kind == .upcoming }
        let placed = live + upcoming
        let corePosition = SCNVector3(0, 0.4, 0)

        let nonCore = placed.filter { $0.kind != .core }
        // Slot the combined non-core row (live devices + dimmed upcoming)
        // but reserve the center gap for core: when the middle slot would
        // hold a live device, shift the live row half a slot so no live
        // node lands at x=0 under the core sphere. Upcoming keeps its slot
        // in the dimmed back row.
        let middleIsLive = nonCore.count % 2 == 1 && nonCore[nonCore.count / 2].kind != .upcoming
        for node in placed {
            let position: SCNVector3
            if node.kind == .core {
                position = corePosition
            } else {
                let deviceIndex = nonCore.firstIndex(of: node) ?? 0
                var slot = Float(deviceIndex) - Float(nonCore.count - 1) / 2.0
                if node.kind != .upcoming && middleIsLive { slot += 0.5 }
                position = SCNVector3(slot * 2.1, node.kind == .upcoming ? -0.9 : 0.1, node.kind == .upcoming ? -1.2 : 0)
            }
            let geometry = geometry(for: node.kind)
            let holder = SCNNode(geometry: geometry)
            holder.position = position
            // Upcoming nodes are visibly dimmed; the SwiftUI overlay carries
            // the GATED — UPCOMING gate and blocks interaction.
            holder.opacity = node.kind == .upcoming ? 0.35 : 1.0
            holder.name = node.id
            scene.rootNode.addChildNode(holder)

            if node.kind != .core && node.kind != .upcoming {
                scene.rootNode.addChildNode(edgeNode(from: corePosition, to: position))
            }
        }
        return scene
    }

    private static func geometry(for kind: TopologyKind) -> SCNGeometry {
        let material = SCNMaterial()
        material.diffuse.contents = color(for: kind)
        material.lightingModel = .lambert
        let geometry: SCNGeometry
        switch kind {
        case .core:
            geometry = SCNSphere(radius: 0.55)
        case .phone:
            geometry = SCNBox(width: 0.45, height: 0.9, length: 0.12, chamferRadius: 0.06)
        case .display:
            geometry = SCNBox(width: 1.15, height: 0.72, length: 0.08, chamferRadius: 0.03)
        case .macbook, .upcoming:
            geometry = SCNBox(width: 0.85, height: 0.6, length: 0.08, chamferRadius: 0.03)
        }
        geometry.materials = [material]
        return geometry
    }

    private static func color(for kind: TopologyKind) -> NSColor {
        switch kind {
        case .core: NSColor.systemOrange
        case .display: NSColor.systemBlue
        case .macbook: NSColor.systemGray
        case .phone: NSColor.systemTeal
        case .upcoming: NSColor.systemGray.withAlphaComponent(0.6)
        }
    }

    /// Solid live edge between core and a live device node.
    private static func edgeNode(from a: SCNVector3, to b: SCNVector3) -> SCNNode {
        let vector = SCNVector3(b.x - a.x, b.y - a.y, b.z - a.z)
        let length = sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
        let cylinder = SCNCylinder(radius: 0.02, height: CGFloat(length))
        let material = SCNMaterial()
        material.diffuse.contents = NSColor.systemGray
        cylinder.materials = [material]
        let node = SCNNode(geometry: cylinder)
        node.position = SCNVector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
        node.look(at: b, up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 1, 0))
        node.opacity = 1.0
        return node
    }
}
#endif

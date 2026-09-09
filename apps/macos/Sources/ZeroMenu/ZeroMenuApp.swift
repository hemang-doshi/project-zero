import SwiftUI
import AppKit
import ZeroKit
import UserNotifications

@MainActor final class ZeroModel:ObservableObject {
 @Published var connected=false
 @Published var runtimeVersion="unknown"
 @Published var uncertain:[String:Any]?
 @Published var compatible=false
 @Published var busy=false
 @Published var error=""
 @Published var session:[String:Any]=[:]
 @Published var projects:[[String:Any]]=[]
 @Published var integrations:[[String:Any]]=[]
 @Published var policies:[[String:Any]]=[]
 @Published var approvals:[[String:Any]]=[]
 @Published var firings:[[String:Any]]=[]
 @Published var context:[String:Any]=[:]
 @Published var proposal:[String:Any]?
 let socket:String
 init(){let args=CommandLine.arguments;if let i=args.firstIndex(of:"--socket"),i+1<args.count{socket=args[i+1]}else{socket=NSHomeDirectory()+"/Library/Application Support/ProjectZero/zero.sock"};if let saved=UserDefaults.standard.data(forKey:"pending:"+socket){uncertain=(try? JSONSerialization.jsonObject(with:saved)) as? [String:Any]};Task{while !Task.isCancelled{await refresh();try? await Task.sleep(nanoseconds:2_000_000_000)}}}
 func get(_ path:String)async throws->Any{try await UnixHTTP.call(socketPath:socket,path:path)}
 func refresh()async {
  do {
   let status=try await get("status") as? [String:Any] ?? [:]
   let release=status["release"] as? [String:Any] ?? [:];runtimeVersion=release["version"] as? String ?? "unknown";compatible=(release["protocols"] as? [String] ?? []).contains("0.1")
   let s=try await get("session") as? [String:Any] ?? [:]
   let p=try await get("projects") as? [String:Any] ?? [:]
   let i=try await get("integrations") as? [String:Any] ?? [:]
   let rules=try await get("policies") as? [String:Any] ?? [:]
   let a=try await get("approvals") as? [[String:Any]] ?? []
   let f=try await get("firings") as? [[String:Any]] ?? []
   let c=try await get("context/current") as? [String:Any] ?? [:]
   session=s;projects=p["projects"] as? [[String:Any]] ?? [];integrations=i["integrations"] as? [[String:Any]] ?? [];policies=rules["policies"] as? [[String:Any]] ?? [];approvals=a;firings=f;context=c["context"] as? [String:Any] ?? [:];connected=true
   await deliverReminders()
  }catch{connected=false}
 }
 func command(_ op:String,_ body:[String:Any]=[:])async {
  guard !busy && compatible else{return}
  guard uncertain == nil else{error="Resolve the pending action before another change.";return}
  uncertain=["id":UUID().uuidString,"op":op,"body":body]
  if let data=try? JSONSerialization.data(withJSONObject:uncertain!){UserDefaults.standard.set(data,forKey:"pending:"+socket)}
  await retryPending()
 }
 func retryPending()async {
  guard !busy,compatible,let request=uncertain else{return};busy=true;error="";defer{busy=false}
  do{_ = try await UnixHTTP.call(socketPath:socket,path:"commands",body:request);uncertain=nil;UserDefaults.standard.removeObject(forKey:"pending:"+socket);await refresh()}catch{if let rejection=error as? ZeroError,rejection.rejected {uncertain=nil;UserDefaults.standard.removeObject(forKey:"pending:"+socket);self.error=rejection.localizedDescription;return};self.error="Action not confirmed: \(error.localizedDescription). Retry uses the same request identity."}
 }
 func parse(_ text:String)async {do{var allowed=CharacterSet.urlQueryAllowed;allowed.remove(charactersIn:"&+=?#");let encoded=text.addingPercentEncoding(withAllowedCharacters:allowed) ?? "";proposal=try await get("intent/parse?text="+encoded) as? [String:Any]}catch{self.error=error.localizedDescription}}
 func enableNotifications() async {
  do {let granted=try await UNUserNotificationCenter.current().requestAuthorization(options:[.alert]);if !granted{error="Notifications are disabled in macOS settings; reminders remain visible here."}} catch {self.error=error.localizedDescription}
 }
 func testNotification()async{do{let content=UNMutableNotificationContent();content.title="Zero setup check";content.body="Desktop reminders are working. This is a manual setup test.";try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier:"zero-setup-test",content:content,trigger:nil))}catch{self.error=error.localizedDescription}}
 func deliverReminders() async {
  let center=UNUserNotificationCenter.current();let settings=await center.notificationSettings()
  guard settings.authorizationStatus == .authorized else{return}
  for record in firings {
   guard let f=record["value"] as? [String:Any],f["state"] as? String=="PENDING",f["policy"] as? String=="focus-break",let id=f["id"] as? String else{continue}
   do {
    let claim=try await UnixHTTP.call(socketPath:socket,path:"commands",body:["id":UUID().uuidString,"op":"notifications.claim","body":["id":id]]) as? [String:Any]
    guard let committed=claim?["data"] as? [String:Any],committed["state"] as? String=="DELIVERING" else{continue}
    let content=UNMutableNotificationContent();content.title="Time for a pause?";content.body=committed["message"] as? String ?? "Take a break when ready."
    var state="DELIVERED"
    do {try await center.add(UNNotificationRequest(identifier:id,content:content,trigger:nil))} catch {state="FAILED"}
    _ = try await UnixHTTP.call(socketPath:socket,path:"commands",body:["id":UUID().uuidString,"op":"notifications.result","body":["id":id,"state":state]])
   } catch {self.error="Reminder delivery could not be confirmed. Check automation history."}
  }
 }
 var pendingCount:Int {firings.filter{($0["value"] as? [String:Any])?["state"] as? String=="PENDING"}.count}
 var timer:String{let seconds=(session["elapsed_ms"] as? Int ?? 0)/1000;return String(format:"%02d:%02d",seconds/60,seconds%60)}
}

struct ZeroPanel: View {
 @ObservedObject var model: ZeroModel
 @State private var project = ""
 @State private var phrase = ""
 @State private var switching = false
 var body: some View {
  ScrollView {
   VStack(alignment: .leading, spacing: 12) {
    HStack {
     Text("Project Zero").font(.title2.bold())
     Spacer()
     Text(model.connected ? "Connected" : "Disconnected").foregroundStyle(model.connected ? .green : .orange)
    }
    if model.socket != NSHomeDirectory()+"/Library/Application Support/ProjectZero/zero.sock" {Text("Isolated development profile").font(.caption).foregroundStyle(.secondary)}
    Text("App \(ZeroRelease.version) · Runtime \(model.runtimeVersion) · Build \(ZeroRelease.build)").font(.caption).foregroundStyle(.secondary)
    if !model.compatible {Text("Runtime compatibility unavailable; controls disabled.").font(.caption)}
    if model.uncertain != nil {Button("Retry pending action") {Task {await model.retryPending()}}}
    Text(model.session["project"] as? String ?? "Choose a project").font(.headline)
    HStack {
     Text(model.session["state"] as? String ?? "Unavailable")
     Spacer()
     Text(model.timer).font(.system(.title, design: .monospaced))
    }
    Picker("Project", selection: $project) {
     Text("Select…").tag("")
     ForEach(model.projects.indices, id: \.self) { i in
      Text(model.projects[i]["name"] as? String ?? "Project").tag(model.projects[i]["id"] as? String ?? "")
     }
    }
    HStack {
     Button("Start") {
      if (model.session["state"] as? String ?? "IDLE") != "IDLE" && model.session["project_id"] as? String != project {
       switching = true
      } else { Task { await model.command("session.start", ["project_id": project]) } }
     }.disabled(project.isEmpty)
     Button("Pause") { Task { await model.command("session.pause") } }
     Button("Resume") { Task { await model.command("session.resume") } }
     Button("End") { Task { await model.command("session.end") } }
    }.disabled(!model.connected || !model.compatible || model.busy)
    if switching {
     Text("End current focus before starting the selected project?")
     HStack {
      Button("End current") { Task { await model.command("session.end"); switching = false } }
      Button("Cancel") { switching = false }
     }
    }
    Divider()
    TextField("Work on Project Zero", text: $phrase).textFieldStyle(.roundedBorder)
    Button("Preview intent") { Task { await model.parse(phrase) } }.disabled(phrase.isEmpty || !model.connected)
    if let p = model.proposal {
     Text(p["operation"] as? String ?? p["reason"] as? String ?? "Clarification needed").font(.caption)
     if p["status"] as? String == "READY" {
      Button("Run reviewed intent") {
       let text = p["text"] as? String ?? ""
       Task { await model.command("intent.run", ["text": text]); model.proposal = nil }
      }.disabled(model.busy)
     }
     Text("Local parsing · no model call").font(.caption).foregroundStyle(.secondary)
    }
    Divider()
    Text("Context and sources").font(.headline)
    ForEach(model.context.keys.sorted(),id: \.self) { key in
     if let fact=model.context[key] as? [String:Any] {Text("\(key): \(fact["value"] as? String ?? "—") · \(fact["source"] as? String ?? "unknown")").font(.caption)}
    }
    Text("Integrations").font(.headline)
    ForEach(model.integrations.indices, id: \.self) { i in IntegrationRow(model: model, item: model.integrations[i]) }
    Divider()
    Text("Automations").font(.headline)
    Button("Allow macOS reminders") {Task {await model.enableNotifications()}}
    Button("Send setup test reminder") {Task {await model.testNotification()}}
    ForEach(model.policies.indices, id: \.self) { i in PolicyRow(model: model, item: model.policies[i]) }
    ForEach(Array(model.firings.prefix(8).enumerated()), id: \.offset) { _, record in
     if let f = record["value"] as? [String: Any], f["state"] as? String != "CANCELLED" { FiringRow(model: model, item: f) }
    }
    if !model.approvals.isEmpty {
     Divider()
     Text("Approvals").font(.headline)
     ForEach(model.approvals.indices, id: \.self) { i in ApprovalRow(model: model, item: model.approvals[i]) }
    }
    if model.busy { ProgressView("Waiting for committed result…") }
    if !model.error.isEmpty { Text(model.error).foregroundStyle(.red).font(.caption).textSelection(.enabled) }
    Text("Codex observation and optional model parsing are not connected.").font(.caption).foregroundStyle(.secondary)
    Button("Quit interface") { NSApplication.shared.terminate(nil) }
   }.padding(16)
  }.frame(width: 400, height: 650)
 }
}
struct IntegrationRow: View {
 @ObservedObject var model: ZeroModel
 let item: [String: Any]
 var body: some View {
  let id = item["id"] as? String ?? ""
  let enabled = item["enabled"] as? Bool ?? false
  VStack(alignment: .leading) {
   HStack {
    Text(id.capitalized)
    Spacer()
    Text(item["status"] as? String ?? "Unavailable").font(.caption)
    if id != "codex" { Button(enabled ? "Disconnect" : "Connect") { Task { await model.command(enabled ? "integrations.disconnect" : "integrations.connect", ["id": id]) } } }
   }
   if let data = item["data"] as? [String: String] { Text(data.keys.sorted().map { "\($0): \(data[$0]!)" }.joined(separator: " · ")).font(.caption).lineLimit(3) }
   if let message = item["message"] as? String { Text(message).font(.caption).foregroundStyle(.secondary) }
  }
 }
}
struct PolicyRow: View {
 @ObservedObject var model: ZeroModel
 let item: [String: Any]
 var body: some View {
  let id = item["id"] as? String ?? ""
  let enabled = item["enabled"] as? Bool ?? false
  HStack {
   Text(id)
   Spacer()
   Button(enabled ? "Disable" : "Enable") { Task { await model.command(enabled ? "policies.disable" : "policies.apply", ["id": id]) } }.disabled(id == "codex-completion" || model.busy)
  }
 }
}
struct FiringRow: View {
 @ObservedObject var model: ZeroModel
 let item: [String: Any]
 var body: some View {
  VStack(alignment: .leading) {
   Text(item["message"] as? String ?? "Automation event").font(.caption)
   HStack {
    Text(item["review"] as? String ?? "unreviewed").font(.caption).foregroundStyle(.secondary)
    Button("Correct") { Task { await model.command("policies.review", ["id": item["id"] as? String ?? "", "review": "correct"]) } }
    Button("Incorrect") { Task { await model.command("policies.review", ["id": item["id"] as? String ?? "", "review": "incorrect"]) } }
   }
  }
 }
}
struct ApprovalRow: View {
 @ObservedObject var model: ZeroModel
 let item: [String: Any]
 var body: some View {
  VStack(alignment: .leading) {
   Text("\(item["capability"] ?? "") → \(item["node"] ?? "")")
   Text(String(describing: item["input"] ?? "")).font(.caption).textSelection(.enabled)
   HStack {
    Button("Approve exact action") { Task { await model.command("approvals.approve", ["id": item["id"] ?? ""]) } }
    Button("Deny") { Task { await model.command("approvals.deny", ["id": item["id"] ?? ""]) } }
   }
  }
 }
}
@main struct ZeroMenuApp: App {
 @StateObject private var model = ZeroModel()
 var body: some Scene {
  MenuBarExtra { ZeroPanel(model: model) } label: { Label(model.connected ? "Zero \(model.timer)\(model.pendingCount > 0 ? " •" : "")" : "Zero offline", systemImage: "circle.dotted") }.menuBarExtraStyle(.window)
 }
}

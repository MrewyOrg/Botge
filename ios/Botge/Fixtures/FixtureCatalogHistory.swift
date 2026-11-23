#if DEBUG
import Foundation
import Synchronization

/// Answers catalog history requests with a complete preview and optional recovery scenarios.
final class FixtureCatalogHistory: Sendable {
  private struct State {
    var firstRead = true
    var restored = false
    var failRead = false
  }

  /// The initial fixture's latest revision.
  private nonisolated static let currentRevision = 5
  /// The history to list before editing, including every supported revision label.
  private nonisolated static let revisions = """
  {"currentRevision":5,"revisions":[
    {"revision":5,"recordedAt":5,"actorId":"11","edit":{"type":"restored","revision":0}},
    {"revision":4,"recordedAt":4,"actorId":null,"edit":{"type":"future"}},
    {"revision":3,"recordedAt":3,"actorId":"11","edit":{"type":"settings"}},
    {"revision":2,"recordedAt":2,"actorId":"11","edit":{"type":"removed","name":"Wave"}},
    {"revision":1,"recordedAt":1,"actorId":"11","edit":{"type":"added","name":"Clap"}},
    {"revision":0,"recordedAt":0,"actorId":null,"edit":{"type":"baseline"}}
  ]}
  """
  /// A policy whose 7TV set and manager list are empty.
  private nonisolated static let initialPolicy =
    #"{"sevenTvSet":null,"allowEveryone":false,"allowedRoles":[]}"#
  /// A preview that changes each of the fields shown by the screen.
  private nonisolated static let changes = """
  {"currentRevision":5,"targetRevision":0,"added":["Wave"],"removed":["Clap"],
    "updated":["Dance"],"orderChanged":true,"currentSettings":\(initialPolicy),
    "restoredSettings":{"sevenTvSet":"01234567890123456789ABCD","allowEveryone":true,
      "allowedRoles":["300000000000000001"]}}
  """
  /// A preview matching the current revision.
  private nonisolated static let unchanged = """
  {"currentRevision":5,"targetRevision":5,"added":[],"removed":[],"updated":[],
    "orderChanged":false,"currentSettings":\(initialPolicy),"restoredSettings":\(initialPolicy)}
  """

  /// Whether this UI test opens an empty history first and loses the post-restore refresh.
  private let testsRecovery =
    ProcessInfo.processInfo.environment["BOTGE_UI_HISTORY_RECOVERY"] == "1"
  /// Records which history responses this fixture has already served.
  private let state: Mutex = .init(State())

  deinit {
    // The fixture owns only in-memory state.
  }

  /// Returns the fixture body for a catalog history request.
  ///
  /// - Parameters:
  ///   - route: The app API route.
  ///   - request: The requested revision and expected current revision, when present.
  /// - Returns: A JSON fixture, or `nil` if the request fails.
  nonisolated func body(route: String, request: URLRequest) -> String? {
    switch route {
    case "catalog/history":
      history()

    case "catalog/history/preview":
      switch Self.fields(in: request)["revision"] {
      case 0:
        Self.changes

      case Self.currentRevision:
        Self.unchanged

      default:
        nil
      }

    case "catalog/history/restore":
      restore(request)

    default:
      nil
    }
  }

  /// Returns the empty, restored, or initial history, or injects a failed follow-up read.
  private nonisolated func history() -> String? {
    state.withLock { state in
      if state.failRead {
        state.failRead = false
        return nil
      }
      if state.firstRead {
        state.firstRead = false
        if testsRecovery {
          return #"{"currentRevision":0,"revisions":[]}"#
        }
      }
      if state.restored {
        return """
        {"currentRevision":6,"revisions":[
          {"revision":6,"recordedAt":6,"actorId":"11","edit":{"type":"restored","revision":0}}
        ]}
        """
      }
      return Self.revisions
    }
  }

  /// Confirms only the tested preview and optionally fails the next history read.
  ///
  /// - Parameter request: The submitted restore confirmation.
  /// - Returns: The new revision as JSON, or `nil` if the confirmation does not match.
  private nonisolated func restore(_ request: URLRequest) -> String? {
    let fields = Self.fields(in: request)
    guard fields["revision"] == 0, fields["expectedRevision"] == Self.currentRevision else {
      return nil
    }

    state.withLock { state in
      state.restored = true
      state.failRead = testsRecovery
    }
    return #"{"currentRevision":6}"#
  }

  /// Reads the numeric revision fields of a request.
  ///
  /// - Parameter request: The request whose JSON contains the revision fields.
  /// - Returns: The numeric fields the fixture can use.
  private nonisolated static func fields(in request: URLRequest) -> [String: Int] {
    guard let body = request.httpBody,
          let fields = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    else {
      return [:]
    }

    return fields.compactMapValues { $0 as? Int }
  }
}
#endif

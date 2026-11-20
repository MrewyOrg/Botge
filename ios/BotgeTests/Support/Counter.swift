/// Counts calls from any task, such as authentication prompts.
actor Counter {
  /// The number of calls so far.
  private(set) var count = 0

  /// Counts one call.
  func increment() {
    count += 1
  }
}

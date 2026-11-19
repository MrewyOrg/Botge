@testable import BotgeKit
import Foundation
import Testing

struct LoginFailureTests {
  @Test
  func `only transient failures are retryable`() {
    let retryable: [LoginFailure] = [.network, .pageFailed, .presentationUnavailable]
    let final: [LoginFailure] = [
      .cancelled,
      .denied("x"),
      .malformedResponse,
      .rejected,
      .stateMismatch
    ]
    let retryableFlags = retryable.map(\.isRetryable)
    let finalFlags = final.map(\.isRetryable)
    #expect(retryableFlags == [true, true, true])
    #expect(finalFlags == [false, false, false, false, false])
  }

  @Test
  func `URL errors map to cancellation or network failure`() {
    let cancelled = LoginFailure(authenticationError: URLError(.cancelled))
    let timedOut = LoginFailure(authenticationError: URLError(.timedOut))
    #expect(cancelled == .cancelled)
    #expect(timedOut == .network)
  }

  @Test
  func `login failures pass through unchanged`() {
    #expect(LoginFailure(authenticationError: LoginFailure.stateMismatch) == .stateMismatch)
  }
}

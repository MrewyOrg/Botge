import BotgeKit

/// One Botge API request run concurrently with others while the Server tab loads.
typealias APICall<Value> = () async throws(APIError) -> Value

import { describe, expect, test } from "bun:test"

import { extractOAuthAuthorizationCode } from "../../src/cli/cmd/auth"

describe("extractOAuthAuthorizationCode", () => {
  test("returns raw code unchanged", () => {
    const input = "4/0AfFakeCode_abc123"
    expect(extractOAuthAuthorizationCode(input)).toBe(input)
  })

  test("extracts code from callback URL", () => {
    const input =
      "http://localhost:8085/oauth2callback?code=4%2F0AfFake%2FCode&scope=openid"
    expect(extractOAuthAuthorizationCode(input)).toBe("4/0AfFake/Code")
  })

  test("extracts code from nested redirect param", () => {
    const input =
      "http://localhost:8085/login?redirect=%2Ffiles%2Foauth2callback%3Fcode%3D4%252F0AfNested%252FCode%26scope%3Dopenid"
    expect(extractOAuthAuthorizationCode(input)).toBe("4/0AfNested/Code")
  })

  test("extracts code from pasted multi-line output", () => {
    const input = `Paste the authorization code here:
http://localhost:8085/login?redirect=%2Ffiles%2Foauth2callback%3Fcode%3D4%252F0AfLine%252FCode%26scope%3Dopenid
Done`
    expect(extractOAuthAuthorizationCode(input)).toBe("4/0AfLine/Code")
  })
})

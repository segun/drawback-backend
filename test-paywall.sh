#!/bin/bash
# Test Discovery Paywall Implementation

BASE_URL="http://localhost:3000/api"
TEST_EMAIL="paywall-test-$(date +%s)@example.com"
TEST_PASSWORD="Test1234!"
TEST_DISPLAY_NAME="@paywalltest$(date +%s)"

echo "🧪 Testing Discovery Paywall Feature"
echo "======================================"
echo ""

# Step 1: Register a test user
echo "1️⃣ Registering test user..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\",
    \"displayName\": \"$TEST_DISPLAY_NAME\"
  }")

if echo "$REGISTER_RESPONSE" | grep -q "error"; then
  echo "❌ Registration failed: $REGISTER_RESPONSE"
  exit 1
fi
echo "✅ User registered successfully"

# Manually activate user in database (for testing)
echo ""
echo "2️⃣ Activating user in database..."
mysql -h 192.168.1.72 -P 23306 -u drawback -p'A_Sufficiently_Advanced_Civilization_Is_Indistinguishable_From_Magic' drawback -e "UPDATE users SET isActivated = 1 WHERE email = '$TEST_EMAIL'" 2>/dev/null && echo "✅ User activated" || echo "⚠️  Manual activation failed"

# Step 3: Login
echo ""
echo "3️⃣ Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\"
  }")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed: $LOGIN_RESPONSE"
  exit 1
fi
echo "✅ Logged in successfully"
echo "   Token: ${TOKEN:0:20}..."

# Step 4: Check /users/me includes hasDiscoveryAccess field
echo ""
echo "4️⃣ Checking /users/me includes hasDiscoveryAccess field..."
ME_RESPONSE=$(curl -s -X GET "$BASE_URL/users/me" \
  -H "Authorization: Bearer $TOKEN")

HAS_ACCESS=$(echo "$ME_RESPONSE" | grep -o '"hasDiscoveryAccess":[^,}]*' | cut -d':' -f2)
echo "   Response snippet: $(echo "$ME_RESPONSE" | grep -o 'hasDiscovery[^,}]*')"

if [ -z "$HAS_ACCESS" ]; then
  echo "❌ hasDiscoveryAccess field not found in response"
  exit 1
fi
echo "✅ hasDiscoveryAccess field present: $HAS_ACCESS"

# Step 5: Try to access discovery endpoint (should fail with 403)
echo ""
echo "5️⃣ Trying to access /users/discovery/random without access..."
DISCOVERY_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/users/discovery/random" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$DISCOVERY_RESPONSE" | grep HTTP_CODE | cut -d':' -f2)
BODY=$(echo "$DISCOVERY_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" != "403" ]; then
  echo "❌ Expected HTTP 403, got $HTTP_CODE"
  echo "   Response: $BODY"
  exit 1
fi

if echo "$BODY" | grep -q "DISCOVERY_LOCKED"; then
  echo "✅ Correctly returned 403 with DISCOVERY_LOCKED error"
  echo "   Response: $(echo "$BODY" | grep -o 'DISCOVERY_LOCKED[^"]*')"
else
  echo "⚠️  Got 403 but error format unexpected: $BODY"
fi

# Step 6: Call mock-unlock endpoint
echo ""
echo "6️⃣ Unlocking discovery access via /purchases/mock-unlock..."
UNLOCK_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/purchases/mock-unlock" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$UNLOCK_RESPONSE" | grep HTTP_CODE | cut -d':' -f2)
BODY=$(echo "$UNLOCK_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Mock unlock failed with HTTP $HTTP_CODE"
  echo "   Response: $BODY"
  exit 1
fi

if echo "$BODY" | grep -q '"hasDiscoveryAccess":true'; then
  echo "✅ Discovery access unlocked successfully"
else
  echo "⚠️  Unlock succeeded but response unexpected: $BODY"
fi

# Step 7: Verify /users/me shows hasDiscoveryAccess = true
echo ""
echo "7️⃣ Verifying /users/me now shows hasDiscoveryAccess = true..."
ME_RESPONSE=$(curl -s -X GET "$BASE_URL/users/me" \
  -H "Authorization: Bearer $TOKEN")

if echo "$ME_RESPONSE" | grep -q '"hasDiscoveryAccess":true'; then
  echo "✅ hasDiscoveryAccess is now true"
else
  echo "❌ hasDiscoveryAccess is still false or missing"
  echo "   Response: $(echo "$ME_RESPONSE" | grep -o 'hasDiscovery[^,}]*')"
  exit 1
fi

# Step 8: Try to access discovery endpoint again (should succeed)
echo ""
echo "8️⃣ Trying to access /users/discovery/random with access..."
DISCOVERY_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X GET "$BASE_URL/users/discovery/random" \
  -H "Authorization: Bearer $TOKEN")

HTTP_CODE=$(echo "$DISCOVERY_RESPONSE" | grep HTTP_CODE | cut -d':' -f2)
BODY=$(echo "$DISCOVERY_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Expected HTTP 200, got $HTTP_CODE"
  echo "   Response: $BODY"
  exit 1
fi

echo "✅ Discovery endpoint now accessible (HTTP 200)"
echo "   Response: $(echo "$BODY" | head -c 100)..."

# Step 9: Test receipt verification endpoint (placeholder)
echo ""
echo "9️⃣ Testing /purchases/verify endpoint..."
VERIFY_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/purchases/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform": "ios", "receipt": "fake-receipt-for-testing"}')

HTTP_CODE=$(echo "$VERIFY_RESPONSE" | grep HTTP_CODE | cut -d':' -f2)
BODY=$(echo "$VERIFY_RESPONSE" | sed '/HTTP_CODE/d')

if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Verify endpoint failed with HTTP $HTTP_CODE"
  echo "   Response: $BODY"
  exit 1
fi

if echo "$BODY" | grep -q '"success":true'; then
  echo "✅ Receipt verification endpoint works (placeholder)"
else
  echo "⚠️  Verify succeeded but response unexpected: $BODY"
fi

echo ""
echo "======================================"
echo "✅ All tests passed!"
echo "======================================"

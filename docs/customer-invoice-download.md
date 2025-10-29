# Customer Invoice Download Guide

This guide explains how a customer-facing frontend can download an order invoice PDF using the backend route `GET /order/:orderId/invoice`.

## Prerequisites
- The customer is authenticated and holds a valid JWT access token issued by the backend (same token returned from the customer login endpoint).  
- The frontend knows the numeric `orderId` the user wants to download. Customers may only download invoices for their own orders; the backend rejects mismatched customer IDs.
- The frontend can make HTTPS requests to the API host (examples below assume the base URL `https://api.dpmsign.com`). Adjust as needed for staging or development environments.

## Endpoint Overview
- **Method:** `GET`
- **Path:** `/order/:orderId/invoice`
- **Path Parameters:**
  - `orderId` (required, integer): the order identifier returned by order listing/detail APIs.
- **Headers:**
  - `Authorization: Bearer <customerAccessToken>` (required)
  - `Accept: application/pdf` (optional but recommended)
- **Request Body:** none. The route ignores JSON payloads; only the path parameter and headers are required.

## Expected Response
- **Status 200** with a binary PDF payload. Response headers include:
  - `Content-Type: application/pdf`
  - `Content-Disposition: attachment; filename=invoice-order-<orderId>.pdf`
- **Error Responses:**
  - `401 Unauthorized` if the token is missing or invalid.
  - `403 Forbidden` if the token belongs to a different customer than the order.
  - `404 Not Found` if the order does not exist.
  - `500 Internal Server Error` for unexpected failures.

## Fetch Example (TypeScript / JavaScript)
```ts
async function downloadInvoice(orderId: number, token: string) {
  const url = `https://api.dpmsign.com/order/${orderId}/invoice`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/pdf",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Invoice download failed (${response.status}): ${errorText}`);
  }

  const blob = await response.blob();
  const filename = response.headers.get("Content-Disposition")?.split("filename=")?.[1] ?? `invoice-${orderId}.pdf`;

  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename.replace(/"/g, "");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}
```

## Axios Example
```ts
import axios from "axios";

async function downloadInvoiceWithAxios(orderId: number, token: string) {
  const url = `https://api.dpmsign.com/order/${orderId}/invoice`;
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/pdf",
    },
  });

  const blob = new Blob([response.data], { type: "application/pdf" });
  const filename = response.headers["content-disposition"]?.split("filename=")?.[1] ?? `invoice-${orderId}.pdf`;

  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename.replace(/"/g, "");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}
```

## Handling Tokens
- When the customer logs in, store the returned JWT securely (e.g., HTTP-only cookie or memory).
- Include the token in the `Authorization` header for the invoice request.
- If the backend responds with `401`, refresh the token or force the customer to re-authenticate.

## Validation Notes
- The backend automatically checks that the authenticated customer is the owner of the order. No additional payload fields are required from the frontend.
- Passing a JSON body is unnecessary and ignored. Ensure the request is a plain `GET` without `Content-Type: application/json` unless the HTTP client sets it implicitly.

## Error Handling Recommendations
- Map HTTP errors to user-friendly messages:
  - `401`: ask the user to sign in again.
  - `403`: display "You do not have access to this invoice." (the customer might have selected another person’s order ID).
  - `404`: show "Invoice not found." and prompt the user to verify the order.
  - Other statuses: show a generic error and allow retry.
- Log errors (with sanitized details) to help diagnose issues.

## Testing Checklist
1. Log in as a customer and obtain a JWT.
2. Call the endpoint with an order that belongs to that customer. Confirm a PDF downloads and opens correctly.
3. Attempt to call the endpoint with an order that belongs to another customer. The backend should return `403`.
4. Test expired or missing tokens to verify the `401` path.
5. Validate multi-page invoices (orders with >6 line items) to ensure the PDF renders correctly.

This file should give the frontend team everything they need to integrate the invoice download feature for customer accounts.

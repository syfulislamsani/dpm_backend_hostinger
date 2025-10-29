import { getBrowserInstance } from "./puppeteerInstance";
import fs from "fs";
import path from "path";

type OrderItem = any;
type Payment = any;

const formatCurrency = (v: number | string) => {
	const n = Number(v || 0);
	return n.toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	});
};

const escapeHtml = (str: any) => {
	if (str == null) return "";
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
};

// Try to embed the local SVG logo as a data URL so Puppeteer can render it reliably
const getInlineLogoDataUrl = (): string => {
	const candidates = [
		path.join(process.cwd(), "src", "utils", "logo", "Untitled-1.png"),
		path.join(process.cwd(), "src", "utils", "logo", "logo.svg"),
		path.join(__dirname, "logo", "Untitled-1.png"),
		path.join(__dirname, "logo", "logo.svg"),
		path.join(process.cwd(), "dist", "utils", "logo", "Untitled-1.png"),
		path.join(process.cwd(), "dist", "utils", "logo", "logo.svg"),
	];
	const mimeByExt: Record<string, string> = {
		".svg": "image/svg+xml",
		".svgz": "image/svg+xml",
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".webp": "image/webp",
	};
	for (const p of candidates) {
		try {
			if (fs.existsSync(p)) {
				const fileBuffer = fs.readFileSync(p);
				const b64 = Buffer.from(fileBuffer).toString("base64");
				const ext = path.extname(p).toLowerCase();
				const mime = mimeByExt[ext] || "application/octet-stream";
				return `data:${mime};base64,${b64}`;
			}
		} catch {}
	}
	return (
		process.env.INVOICE_LOGO_URL ||
		"http://localhost:4000/static/static-images/logo.png"
	);
};

const buildInvoiceHTML = (order: any) => {
	const items: OrderItem[] = order.orderItems || [];
	const payments: Payment[] = order.payments || [];
	const itemsPerPage = 10;

	const company = {
		name: "Dhaka Plastic & Metal",
		phone: "+8801919960198",
		phone2: "+8801858253961",
		email: "info@dpmsign.com",
		address:
			"Shop No: 94 & 142, Dhaka University Market, Katabon Road, Dhaka-1000",
		logo: getInlineLogoDataUrl(),
	};

	const invoiceNo = order.orderId;
	const orderDate = order.createdAt
		? new Date(order.createdAt).toLocaleDateString()
		: "";
	const deliveryDate = order.deliveryDate
		? new Date(order.deliveryDate).toLocaleDateString()
		: "";

	const currency = order.currencyCode || order.currency || "BDT";
	const displayCurrency = /bdt|tk/i.test(String(currency))
		? "Tk"
		: String(currency);
	// Financial calculations (mirror frontend logic)
	const toNum = (v: unknown) => {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	};

	const computedSubTotal = items.reduce(
		(s, it) => s + toNum(it.price || 0),
		0,
	);
	const subTotal =
		computedSubTotal > 0
			? computedSubTotal
			: toNum(order.orderTotalPrice || order.totalAmount || 0);

	// Grand total (prefer coupon-checked price if provided on order)
	const grandTotal = toNum(
		order.orderTotalCouponCheckedPrice ??
			order.grandTotal ??
			order.orderTotalPrice ??
			order.totalAmount ??
			0,
	);

	const agg = items.reduce(
		(acc, it) => {
			const qty = Math.max(1, toNum(it.quantity));
			const unit = toNum(it.unitPrice);
			const addl = toNum(it.additionalPrice);
			const discPct = toNum(it.discountPercentage);
			const design = toNum(it.designCharge);
			const unitBase = unit * qty;
			const addlBase = addl * qty;
			const discountAmt = (unit + addl) * qty * (discPct / 100);
			return {
				unitBaseTotal: acc.unitBaseTotal + unitBase,
				additionalTotal: acc.additionalTotal + addlBase,
				itemDiscountTotal: acc.itemDiscountTotal + discountAmt,
				designChargeTotal: acc.designChargeTotal + design,
			};
		},
		{
			unitBaseTotal: 0,
			additionalTotal: 0,
			itemDiscountTotal: 0,
			designChargeTotal: 0,
		},
	);

	const discountAmount = Math.ceil(Math.max(0, subTotal - grandTotal));

	const totalPaidAmount = (payments || []).reduce(
		(acc, curr) =>
			acc +
			(curr.isPaid || curr.paymentMethod === "cod-payment"
				? toNum(curr.amount)
				: 0),
		0,
	);

	const amountDue = Math.max(0, grandTotal - totalPaidAmount);

	const staffName =
		order.staffName || order.staff?.name || order.agentInfo?.name || "";
	const staffPhone =
		order.staffPhone ||
		order.staff?.phone ||
		order.agentInfo?.phone ||
		order.agentInfo?.contactNo ||
		"";
	const courierName = order.courierName || order.courier?.name || "";

	const renderHeader = () => {
		return `
			<div class="inv-header">
				<div class="left">
					<img src="${company.logo}" alt="logo" class="logo" />
					<div class="company-block">
						<div class="company-name">${company.name}</div>
						<div class="company-tag">Your Trusted Business Partner for Branding Solutions.</div>
						<div class="email-link">info@dpmsign.com <span class="company-tag"> | </span> www.dpmsign.com </div>
					</div>
				</div>
				<div class="right">
					<div class="invoice-title">INVOICE</div>
					<div class="invoice-no">DPM-${invoiceNo}</div>
					<div class="small">Order Date: ${orderDate || "-"}</div>
					<div class="small">Delivery Date: ${deliveryDate || "-"}</div>
				</div>
			</div>
		`;
	};

	const renderFooter = () => {
		return `
		<div class="inv-footer">
			<div class="footer-top">
				<div class="nb">
					<div><b>NB: Delivery and Installation charges are the customer's responsibility (if applicable).</b></div>
					<div>Thank you for choosing Dhaka Plastic & Metal!</div>
				</div>
				<div class="staff-block">
					<div class="staff-name">${escapeHtml(staffName || "")}</div>
					<div class="staff-phone">${escapeHtml(staffPhone || "")}</div>
					<div class="sig-line"></div>
					<div class="sig-label">Authorized Signature</div>
				</div>
			</div>

			<div class="footer-divider"></div>

			<div class="footer-contact-block" style="font-size:10px; color:#222; margin-top:2px; margin-bottom:2px; text-align:center;">
				<span style="font-weight:700;">Need Help? Complaints:</span> ${company.phone}, ${company.phone2}
				<span style="font-weight:700; margin-left:12px;">| Delivery & Product Updates:</span> ${company.phone}
				<div><span style="font-weight:700; margin-left:12px;">Location:</span> Shop 94 & 142, Dhaka University Market, Katabon Road, Dhaka-1000, Bangladesh </div>
			</div>
		</div>
	`;
	};

	const renderItemsTable = (
		pageStartIndex: number,
		pageItems: OrderItem[],
	) => {
		const rows = pageItems
			.map((it, idx) => {
				const productName =
					it.unlistedProduct?.name || it.product?.name || "Item";
				const details = (it.productVariant?.variantDetails ||
					[]) as any[];
				const detailLabels = details
					.map((detail: any) => {
						const varName =
							detail?.variationItem?.variation?.name || "";
						const varUnit =
							detail?.variationItem?.variation?.unit || "";
						const val = detail?.variationItem?.value || "";
						return varName
							? `${varName}: ${val} ${varUnit}`
							: String(val || "");
					})
					.filter(Boolean)
					.join("; ");

				const sizeNum = toNum(it.size);
				const sizeLabel =
					Number.isFinite(sizeNum) &&
					sizeNum > 0 &&
					it.widthInch != null &&
					it.heightInch != null
						? ` (${it.widthInch} inch x ${it.heightInch} inch)`
						: "";

				const qty = Math.max(1, toNum(it.quantity));
				const unitBase =
					toNum(it.unitPrice) + toNum(it.additionalPrice);
				const discPct = toNum(it.discountPercentage);
				const hasBreakdown = unitBase > 0 || discPct > 0;
				const fallback = qty ? toNum(it.price) / qty : 0;
				const unitNet = hasBreakdown
					? unitBase * (1 - discPct / 100)
					: fallback;
				const price = toNum(it.price);

				return `<tr>
					<td class="tcenter">${pageStartIndex + idx + 1}</td>
					<td><div class="item-title">${productName}${sizeLabel}</div>${detailLabels ? `<div class="item-variant">${detailLabels}</div>` : ""}${it.unlistedProduct?.description ? `<div class="item-desc">${escapeHtml(it.unlistedProduct.description)}</div>` : ""}</td>
					<td class="tcenter">${qty}${qty > 1 ? " pcs" : " pc"}</td>
					<td class="tright">${formatCurrency(unitNet)} ${displayCurrency}</td>
					<td class="tright">${formatCurrency(price)} ${displayCurrency}</td>
				</tr>`;
			})
			.join("\n");

		return `
			<table class="items">
				<thead>
						<tr>
							<th class="col-sn">S/N</th>
							<th class="col-desc">DESCRIPTION</th>
							<th class="col-qty">QTY / SQFT</th>
							<th class="col-unit">UNIT PRICE</th>
							<th class="col-total">TOTAL</th>
						</tr>
				</thead>
				<tbody>
					${rows}
				</tbody>
			</table>
		`;
	};

	const renderPayments = () => {
		if (!payments || payments.length === 0) return "";
		const rows = payments
			.map((p: any, i: number) => {
				const method = p.paymentMethod || p.method || "";
				const status = p.isPaid ? "paid" : "pending";
				const amt = toNum(p.amount);
				return `<tr>
					<td class="tcenter">${i + 1}</td>
					<td>${escapeHtml(method)}</td>
					<td class="tcenter status ${status}">${status}</td>
					<td class="tright">${formatCurrency(amt)} ${displayCurrency}</td>
				</tr>`;
			})
			.join("\n");

		return `
			<table class="payments">
				<thead>
					<tr>
						<th class="col-pay-sn">#</th>
						<th class="col-pay-method">Payment Method</th>
						<th class="col-pay-status">Status</th>
						<th class="col-pay-amount">Amount Paid</th>
					</tr>
				</thead>
				<tbody>
					${rows}
				</tbody>
			</table>
		`;
	};

	const renderBillShip = () => {
		return `
			<div class="invoice-meta">
				<div class="bill-left">
					<div class="meta-title">Billing Information:</div>
					<div style = "font-size: 10px; font-weight: semi-bold;">Name: ${escapeHtml(order.customerName || order.customer?.name || "")}</div>
					<div style = "font-size: 10px; font-weight: semi-bold;">Phone: ${escapeHtml(order.customerPhone || order.customer?.phone || "")}</div>
					<div style = "font-size: 10px; font-weight: semi-bold;">Email: ${escapeHtml(order.customerEmail || order.customer?.email || "")}</div>
					<div style = "font-size: 10px; font-weight: semi-bold;">Address: ${escapeHtml(order.billingAddress || order.customer?.billingAddress || "")}</div>
				</div>
				<div class="bill-right">
  <div class="meta-title">Shipping Information:</div>
  <div style="font-size: 10px; font-weight: semi-bold;">
    Shipping Method: ${escapeHtml(order.deliveryMethod === "courier" ? courierName || "Courier" : "Shop Pickup")}
  </div>
  ${
		order.courierAddress
			? `<div style="font-size: 10px; font-weight: semi-bold;">Address: ${escapeHtml(order.courierAddress)}</div>`
			: ""
  }
</div>

			</div>
		`;
	};

	// Figure out last-page layout constraints before building pages
	// Build page chunks (max 6 items per page). Keep GRAND TOTAL on the same page as the last batch of items.
	// Split items into pages (6 per page)
	//const itemsPerPage = 6;
	const chunks: OrderItem[][] = [];
	for (let i = 0; i < items.length; i += itemsPerPage) {
		chunks.push(items.slice(i, i + itemsPerPage));
	}
	if (chunks.length === 0) chunks.push([]); // always at least one page

	// Helper to estimate content height for payments table
	const estimatePaymentsHeight = (numPayments: number) => {
		// Each payment row roughly ~30px height, plus ~100px headers/margins
		return 100 + numPayments * 30;
	};

	const pages: string[] = [];
	let runningIndex = 0;

	// Render each page of items
	for (let i = 0; i < chunks.length; i++) {
		const pageItems = chunks[i];
		const isLastPage = i === chunks.length - 1;

		let afterTableBlocks = "";

		if (isLastPage) {
			// === Summary / Grand Total Section ===
			const summaryHtml = `
			<div class="summary-wrap">
				<div class="summary-box">
					<div class="row"><span>Sub Total</span><span>${formatCurrency(subTotal - agg.designChargeTotal + discountAmount)} ${displayCurrency}</span></div>
					<div class="row"><span>Design Charge</span><span>${formatCurrency(agg.designChargeTotal)} ${displayCurrency}</span></div>
					<div class="row"><span>Discount</span><span>${formatCurrency(discountAmount)} ${displayCurrency}</span></div>
					<div class="row"><span>Grand Total</span><span>${formatCurrency(grandTotal)} ${displayCurrency}</span></div>
					<div class="row"><span>Amount Paid</span><span>${formatCurrency(totalPaidAmount)} ${displayCurrency}</span></div>
					<div class="grand-row"><span>Amount Due</span><span>${formatCurrency(grandTotal)} ${displayCurrency}</span></div>
				</div>
			</div>
		`;

			// === Payment Section (conditionally moved) ===
			const paymentsHtml =
				payments && payments.length > 0
					? `
			<div class="payments-wrap">
				<div class="section-title">Payment Details</div>
				${renderPayments()}
				<!-- <div class="paid-due">
					<div class="paid">Amount Paid: ${formatCurrency(totalPaidAmount)} ${displayCurrency}</div>
					<div class="due">Amount Due: ${formatCurrency(amountDue)} ${displayCurrency}</div>
				</div> -->
			</div>`
					: `
			<div class="paid-due single">
				<div class="due">Amount Due: ${formatCurrency(amountDue)} ${displayCurrency}</div>
			</div>`;

			// Estimate if payments table would overflow current page
			const estimatedPaymentHeight = estimatePaymentsHeight(
				payments.length,
			);
			const maxPageHeight = 1050; // typical A4 height in px (approx)
			// Estimate base content height: header + items + summary + some buffer for signature
			// Calculate heights for all sections
			const headerHeight = 120; // px
			const billShipHeight = i === 0 ? 80 : 0; // px
			const sectionTitleHeight = 28; // px
			const itemsTableHeight = pageItems.length * 32 + 40; // px (row height + header)
			const summaryHeight = isLastPage ? 110 : 0; // px
			const signatureHeight = 80; // px
			const paymentsTableHeight = payments.length > 0 ? 40 + payments.length * 32 : 0; // px (header + rows)

			// Total height if payment table is included
			const totalHeightWithPayments = headerHeight + billShipHeight + sectionTitleHeight + itemsTableHeight + summaryHeight + paymentsTableHeight + signatureHeight;
			// Total height without payment table
			const totalHeightWithoutPayments = headerHeight + billShipHeight + sectionTitleHeight + itemsTableHeight + summaryHeight + signatureHeight;

			const fitsOnSamePage = totalHeightWithPayments < maxPageHeight;

			if (fitsOnSamePage) {
				// keep payments below summary
				afterTableBlocks = `${summaryHtml}${paymentsHtml}`;
			} else {
				// move payments to new page
				afterTableBlocks = summaryHtml;
			}
		}

		// Build main invoice page
		const pageHtml = `
			<div class="page">
				<div class="page-inner">
					${renderHeader()}
					<div class="content">
						${i === 0 ? renderBillShip() : ""}
						<div class="section-title">Order Details</div>
						${renderItemsTable(runningIndex, pageItems)}
						${afterTableBlocks}
					</div>
					${renderFooter()}
				</div>
			</div>
			`;
		pages.push(pageHtml);
		runningIndex += pageItems.length;
	}

	// === Add an extra page for payments if it didn’t fit ===
	const estimatedPaymentHeight = estimatePaymentsHeight(payments.length);
	const lastChunk = chunks[chunks.length - 1];
	// Recalculate for last page
	const headerHeight = 120;
	const billShipHeight = chunks.length === 1 ? 80 : 0;
	const sectionTitleHeight = 28;
	const itemsTableHeight = lastChunk.length * 32 + 40;
	const summaryHeight = 110;
	const signatureHeight = 80;
	const paymentsTableHeight = payments.length > 0 ? 40 + payments.length * 32 : 0;
	const maxPageHeight = 1050;
	const totalHeightWithPayments = headerHeight + billShipHeight + sectionTitleHeight + itemsTableHeight + summaryHeight + paymentsTableHeight + signatureHeight;
	const paymentsNeedExtraPage = totalHeightWithPayments >= maxPageHeight;

	if (paymentsNeedExtraPage && payments.length > 0) {
		const extraPage = `
			<div class="page">
				<div class="page-inner">
					${renderHeader()}
					<div class="content">
						<div class="section-title">Payment Details</div>
						${renderPayments()}
						<!-- <div class="paid-due">
							<div class="paid">Amount Paid: ${formatCurrency(totalPaidAmount)} ${displayCurrency}</div>
							<div class="due">Amount Due: ${formatCurrency(amountDue)} ${displayCurrency}</div>
						</div> -->
					</div>
					${renderFooter()}
				</div>
			</div>`;
		pages.push(extraPage);
	}

	const html = `
		<html>
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
					<style>
					@page { size: A4; margin: 0; } 
					:root{
						--page-margin: 5mm 10mm 5mm 10mm; /* top right bottom left */ 
						--blue:#0b5fa5;
						--blue-dark:#0a4f8a;
						--border:#d8e2ef;
						--text:#1a1a1a;
						--muted:#6b7280;
					}
					body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; margin:0; padding:0; color:var(--text); }
					/* Each .page represents a physical A4 page. We set an exact page box and then inset the printable area using .page-inner so the footer can be absolutely positioned inside that box. */
					.page { width:210mm; height:297mm; page-break-after: always; position:relative; box-sizing:border-box; }
					.page-inner { position: absolute; inset: var(--page-margin); /* top/right/bottom/left */ display:flex; flex-direction:column; box-sizing:border-box; }
					/* Header */
					.inv-header { display:flex; justify-content:space-between; align-items:center; padding:6px 0 10px; border-bottom:2px solid var(--blue); }
					.inv-header .left { display:flex; align-items:center; gap:12px; }
					.logo { width:70px; height:70px; object-fit:contain; }
					.company-block { line-height:1.15; }
					.company-name { font-weight:700; font-size:29px; color:var(--black); }
					.company-tag { font-size:10px; color: #000; }
					.company-tag.small { font-size:11px; }
					.inv-header .right { text-align:right; }
					.invoice-title { font-weight:800; color:var(--blue); font-size:18px; letter-spacing:0.5px; }
					.invoice-no { font-weight:700; color:#111; }
					.small { font-size:10px; color: #000; }
					.email-link {color: var(--blue); font-size: 10px;}
					/* content area uses flex-grow so the footer can stay pinned without absolute positioning */
					.content { padding:10px 0 20px; flex:1 0 auto; overflow: visible; }
					.section-title { font-weight:700; color: #000; margin:10px 0 8px; font-size:12px; text-transform:uppercase; }

					/* Billing/Shipping */
					.invoice-meta { display:flex; justify-content:space-between; gap:16px; padding:8px 0 6px; }
					.bill-left, .bill-right { width:50%; font-size:11px; padding:8px 10px; }
					.meta-title { font-weight:700; color:#000; margin-bottom:6px; font-size:12px; }

					/* Table */
					table { width:100%; border-collapse:collapse; border-spacing:0; border:1px solid #000; }
					table th, table td { border:1px solid #000; }
					table.items { border-radius:0; overflow:hidden; }
					table.items thead th { background:#3871C2; color:#fff; font-weight:700; font-size:14px; padding:2px 3px; }
					table.items tbody td { padding:2px 3px; font-size:11px; word-break:break-word; }
					.col-sn{ width:44px; text-align:center; }
					.col-desc{ width:auto; }
					.col-qty{ width:100px; text-align:center; }
					.col-unit{ width:150px; text-align:right; }
					.col-total{ width:120px; text-align:right; }
					.muted{ font-weight:400; opacity:.9; }
					.tcenter { text-align:center; }
					.tright { text-align:right; }
					.item-variant { font-size:10px; color:#5f6c7b; margin-top:3px; }
					.item-desc { font-size:10px; color:#4b5563; margin-top:2px; }
					.item-title { font-weight:600; color:#111827; font-size:11px; }

					/* Summary */
					.summary-wrap{ display:flex; justify-content:flex-end; margin-top:12px; }
					.summary-box{ width:320px; border-radius:0px; overflow:hidden; font-size:11px; font-weight:600; }
					.summary-box .row{ display:flex; justify-content:space-between; padding:2px 6px; }
					.summary-box .grand-row{ display:flex; justify-content:space-between; padding:5px; background:#3871C2; color:#fff; font-weight:800; }

					/* Payments */
					.payments-wrap{ margin-top:12px; }
					table.payments{ border:1px solid #000; border-radius:0; overflow:hidden; width:100%; }
					.payments thead th { background:#3871C2; color:#fff; padding:2px 3px; font-size:12px; }
					.payments tbody td { padding:2px 3px; font-size:11px; word-break:break-word; }
					.col-pay-sn{ width:60px; text-align:center; }
					.col-pay-method{ width:auto; text-align:left; }
					.col-pay-status{ width:140px; text-align:left; }
					.col-pay-amount{ width:160px; text-align:right; }
					.status.paid{ color:#0a7f2e; font-weight:700; text-transform:capitalize; text-align:left; }
					.status.pending{ color:#b45309; font-weight:700; text-transform:capitalize; text-align:left; }
					.paid-due{ display:flex; justify-content:space-between; margin-top:8px; font-weight:700; }
					.paid-due.single{ justify-content:flex-end; }
					.paid{ color:#0a7f2e; }
					.due{ color:#111; }

					/* Footer */
					/* Footer stays at the bottom via flex layout so it prints without extra blank space. */
					.inv-footer { border-top:none; padding-top:5px; position:relative; margin-top:auto; box-sizing:border-box; }
					.footer-top{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
					.footer-top .staff-block{ margin-left:auto; }
					.inv-footer .nb{ max-width:65%; font-size:11px; color:#111; display:none; }
					.page:last-child .inv-footer .nb{ display:block; }
					.nb b{ font-weight:800; }
					.staff-block{ text-align:right; min-width:220px; }
					.staff-name{ font-size: 11px; font-weight:700; }
					.staff-phone{ font-size:11px; color:#374151; margin-bottom:6px; }
					.sig-line{ width:180px; height:1px; background:#999; margin-left:auto; }
					.sig-label{ font-size:11px; color:#333; margin-top:4px; }
					.sig-for{ font-size:11px; color:#555; }
					.footer-divider{ height:1px; background:#9aa4b2; margin:4px 0 4px; opacity:.6; }
					.contact-row {
						display: flex;
						justify-content: space-between;
						align-items: center;
						gap: 12px;
						font-size: 11px;
						color: #334155;
					}

					.contact-row .col {
						flex: 1;
						display: flex;
						align-items: center;
						gap: 4px; /* space between icon and text */
					}

					.contact-row .col svg {
						width: 1.2em;
						height: 1.2em;
						min-width: 1.2em;
						fill: #3871C2;
						flex-shrink: 0;
					}

					.contact-row .left div {
						margin: 0;
						line-height: 1.3;
					}

					.contact-row .center {
						justify-content: center;
						text-align: center;
					}

					.contact-row .right {
						justify-content: flex-start;
						text-align: right;
						flex: 0 0 auto;
					}

					/* Prevent clipping: avoid breaking summary and payment blocks across page boundaries and table rows */
					.summary-wrap, .payments-wrap, .invoice-meta, .contact-row { page-break-inside: avoid; }
					table.items tbody tr, table.payments tbody tr { page-break-inside: avoid; break-inside: avoid; }
					.table, table { page-break-inside: auto; }
				</style>
			</head>
			<body>
				${pages.join("\n")}
			</body>
		</html>
	`;

	return html;
};

const generateInvoicePDF = async (order: any) => {
	const browser = await getBrowserInstance();
	let page;
	try {
		page = await browser.newPage();
		await page.setViewport({
			width: 794,
			height: 1123,
			deviceScaleFactor: 1,
		});

		const html = buildInvoiceHTML(order);
		await page.setContent(html, {
			waitUntil: "networkidle0",
			timeout: 30000,
		});

		const pdfBuffer = await page.pdf({
			path: "invoice.pdf",
			format: "A4",
			printBackground: true,
			margin: {
				top: "0mm",
				right: "0mm",
				bottom: "0mm",
				left: "0mm",
			},
		});

		await page.close();
		return pdfBuffer;
	} catch (error) {
		if (page) {
			try {
				await page.close();
			} catch {}
		}
		throw error;
	}
};

export { generateInvoicePDF };

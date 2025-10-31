import axios from "axios";
import {
	sslCommerzSandbox,
	sslCommerzStoreId,
	sslCommerzStorePassword,
	sslCommerzSuccessUrl,
	sslCommerzFailUrl,
	sslCommerzCancelUrl,
} from "../config/dotenv.config";
import Payment, { PaymentAttributes } from "../model/payment.model";
import { generateTransactionId } from "../util";
import { Op, Sequelize } from "sequelize";

class PaymentService {
    private SSLCommerzConfig: {
        store_id: string;
        store_passwd: string;
        sandbox: boolean;
        success_url: string;
        fail_url: string;
        cancel_url: string;
    };

    private BASE_URL: string;

    constructor() {
        this.SSLCommerzConfig = {
            store_id: sslCommerzStoreId,
            store_passwd: sslCommerzStorePassword,
            sandbox: (sslCommerzSandbox || "true").toLowerCase() === "true",
            success_url: sslCommerzSuccessUrl,
            fail_url: sslCommerzFailUrl,
            cancel_url: sslCommerzCancelUrl,
        };

        this.BASE_URL = this.SSLCommerzConfig.sandbox
            ? "https://sandbox.sslcommerz.com"
            : "https://securepay.sslcommerz.com";
    }

	createCashPayment = async (
		orderId: number,
		amount: number,
	): Promise<Payment | PaymentAttributes | null> => {
		try {
			const transactionId = await this.generateUniqueTransactionId();

			// Validate amount against order due
			const Order = require("../model/order.model").default;
			const order = await Order.findByPk(orderId);
			if (!order) throw new Error("Order not found");

			const payments = await Payment.findAll({ where: { orderId } });
			let paid = 0;
			payments.forEach((p: any) => { if (p.isPaid) paid += p.amount; });

			const requestedAmount = Number(amount) || 0;
			if (requestedAmount <= 0) {
				throw new Error("Invalid payment amount requested. Amount must be greater than zero.");
			}

			const due = Math.max(Number(order.orderTotalPrice || 0) - paid, 0);
			if (due === 0) {
				throw new Error("The order is already fully paid. No further payment is necessary.");
			}

			if (requestedAmount > due) {
				throw new Error(`Requested amount (${requestedAmount}) exceeds remaining due (${due}). Please request an amount less than or equal to the remaining due.`);
			}

			const createdPayment = await Payment.create({
				transactionId,
				orderId,
				paymentMethod: "cod-payment",
				amount: requestedAmount,
				isPaid: true,
				paymentLink: null,
			});

			return createdPayment.toJSON();
		} catch (err: any) {
			
			throw err;
		}
	};

    createOnlinePayment = async (
			orderId: number,
			_amount: number, // ignored, always use latest due
			customerName: string,
			customerEmail: string,
			customerPhone: string,
		): Promise<Payment | PaymentAttributes | null> => {
			try {
				const transactionId = await this.generateUniqueTransactionId();

				// Fetch order and payments to calculate latest due
				const Order = require("../model/order.model").default;
				const order = await Order.findByPk(orderId);
				if (!order) throw new Error("Order not found");
				const payments = await Payment.findAll({ where: { orderId } });
				let paid = 0;
				payments.forEach((p: any) => { if (p.isPaid) paid += p.amount; });
				// Use the raw amount passed by the caller. Validate it is a positive number.
				const requestedAmount = Number(_amount) || 0;
				if (requestedAmount <= 0) {
					throw new Error("Invalid payment amount requested. Amount must be greater than zero.");
				}

				// Compute remaining due for the order
				const due = Math.max(Number(order.orderTotalPrice || 0) - paid, 0);

				// Guard: if nothing is due, reject creating an online payment link
				if (due === 0) {
					throw new Error("The order is already fully paid. No payment link is necessary.");
				}

				// Guard: requested amount must not exceed remaining due
				if (requestedAmount > due) {
					throw new Error(`Requested amount (${requestedAmount}) exceeds remaining due (${due}). Please request an amount less than or equal to the remaining due.`);
				}

				// NOTE: per change request, we no longer force the link amount to the remaining due.
				// The admin-supplied amount will be used even if it's different from the computed due.
				const amountToCharge = requestedAmount;

				const expireInHours = 24;
				const expireDate = new Date();
				expireDate.setHours(expireDate.getHours() + expireInHours);
				const expireDateStr = expireDate.toISOString().replace("T", " ").substring(0, 19);

				const params = new URLSearchParams();
				params.append("store_id", this.SSLCommerzConfig.store_id);
				params.append("store_passwd", this.SSLCommerzConfig.store_passwd);
				params.append("total_amount", amountToCharge.toString());
				params.append("currency", "BDT");
				params.append("tran_id", transactionId);
				params.append("success_url", this.SSLCommerzConfig.success_url);
				params.append("fail_url", this.SSLCommerzConfig.fail_url);
				params.append("cancel_url", this.SSLCommerzConfig.cancel_url);
				params.append("emi_option", "0");
				params.append("cus_name", customerName);
				params.append("cus_email", customerEmail);
				params.append("cus_phone", customerPhone);
				params.append("cus_add1", "N/A");
				params.append("cus_city", "N/A");
				params.append("cus_country", "Bangladesh");
				params.append("shipping_method", "NO");
				params.append("num_of_item", "1");
				params.append("product_name", "Order Payment");
				params.append("product_category", "General");
				params.append("product_profile", "general");
				params.append("expire_date", expireDateStr);

				const response = await axios.post(
					`${this.BASE_URL}/gwprocess/v4/api.php`,
					params.toString(),
					{
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						timeout: 15000,
					},
				);

				const data = response?.data || {};
				if (data.status === "SUCCESS" && data.GatewayPageURL) {
					const createdPayment = await Payment.create({
						transactionId,
						orderId,
						paymentMethod: "online-payment",
						amount: amountToCharge,
						isPaid: false,
						paymentLink: data.GatewayPageURL,
					});
					return createdPayment.toJSON();
				}

				const reason =
					data.failedreason || data.reason || data.message || "SSLCommerz session init failed";
				throw new Error(`[SSLCommerz] ${reason}`);
			} catch (err: any) {
				throw err;
			}
		};

	getPaymentByTransactionId = async (
		transactionId: string,
	): Promise<Payment | null> => {
		try {
			const payment = await Payment.findOne({ where: { transactionId } });
			return payment;
		} catch (err: any) {
			
			throw err;
		}
	};

	getPaymentByOrderId = async (
		orderId: number,
	): Promise<Payment[] | PaymentAttributes[] | []> => {
		try {
			const payments = await Payment.findAll({ where: { orderId } });

			return payments ? payments.map((payment) => payment.toJSON()) : [];
		} catch (err: any) {
			
			throw err;
		}
	};

	updatePaymentStatus = async (
		transactionId: string,
		isPaid: boolean,
	): Promise<boolean> => {
		try {
			const payment = await Payment.update(
				{ isPaid },
				{ where: { transactionId } },
			);

			if (!payment) {
				return false;
			}
			// Remove pending payments only if order is fully paid (due == 0)
			// Find the payment record to get orderId
			// const paidPayment = await Payment.findOne({ where: { transactionId } });
			// if (paidPayment && isPaid) {
			// 	const orderId = paidPayment.orderId;
			// 	// Get all payments for this order
			// 	const payments = await Payment.findAll({ where: { orderId } });
			// 	let paid = 0;
			// 	payments.forEach((p: any) => { if (p.isPaid) paid += p.amount; });
			// 	// Get order total
			// 	const Order = require("../model/order.model").default;
			// 	const order = await Order.findByPk(orderId);
			// 	const grandTotal = Number(order?.orderTotalPrice || 0);
			// 	const due = Math.max(grandTotal - paid, 0);
			// 	if (due === 0) {
			// 		await Payment.destroy({
			// 			where: {
			// 				orderId,
			// 				isPaid: false
			// 			}
			// 		});
			// 	}
			// }

			return true;
		} catch (err: any) {
			
			throw err;
		}
	};

	getEarningStats = async () => {
		try {
			const monthlyEarnings = await Payment.findAll({
				attributes: [
					[
						Sequelize.fn(
							"DATE_FORMAT",
							Sequelize.col("createdAt"),
							"%m-%Y",
						),
						"month",
					],
					[Sequelize.fn("SUM", Sequelize.col("amount")), "total"],
				],
				where: {
					isPaid: true,
					createdAt: {
						[Op.gte]: Sequelize.literal(
							"DATE_SUB(CURDATE(), INTERVAL 12 MONTH)",
						), // Last 12 months
					},
				},
				group: ["month"],
				order: [["month", "ASC"]],
			});

			const formattedData = monthlyEarnings.map((item: any) => ({
				month: item.get("month"),
				total: parseFloat(item.get("total")),
			}));

			return formattedData;
		} catch (err: any) {
			
			throw err;
		}
	};

	generateUniqueTransactionId = async (): Promise<string> => {
		let transactionId: string;
		let exists: Payment | null;

		do {
			transactionId = generateTransactionId(true);
			exists = await Payment.findOne({ where: { transactionId } });
		} while (exists);

		return transactionId;
	};

	static cleanupUnpaidPayments = async () => {
		try {
			await Payment.destroy({
				where: {
					createdAt: {
						[Op.lt]: new Date(Date.now() - 24 * 60 * 60 * 1000),
					},
					isPaid: false,
				},
			});
			
		} catch (error) {
			
		}
	};
}

export default PaymentService;

package com.storemanagement.mobile.core.network

sealed interface ApiResult<out T> {
    data class Success<T>(val value: T) : ApiResult<T>
    data class Failure(val error: ApiFailure) : ApiResult<Nothing>
}

sealed interface ApiFailure {
    val message: String

    data object NoConnection : ApiFailure {
        override val message = "تعذر الاتصال بالإنترنت. تحقق من الاتصال ثم أعد المحاولة."
    }

    data object Timeout : ApiFailure {
        override val message = "استغرق الاتصال وقتاً أطول من المتوقع. أعد المحاولة."
    }

    data object SecureConnection : ApiFailure {
        override val message = "تعذر إنشاء اتصال آمن بالخادم."
    }

    data object ConnectionLost : ApiFailure {
        override val message = "انقطع الاتصال بالخادم. أعد المحاولة."
    }

    data object Unauthorized : ApiFailure {
        override val message = "انتهت جلسة الدخول. سجل الدخول مرة أخرى."
    }

    data object Forbidden : ApiFailure {
        override val message = "ليس لديك صلاحية لتنفيذ هذا الإجراء."
    }

    data object NotFound : ApiFailure {
        override val message = "لم يعد هذا السجل متاحاً. حدّث القائمة."
    }

    data class Conflict(val code: String?) : ApiFailure {
        override val message = "تعارضت العملية مع تغيير آخر. راجع النتيجة قبل إعادة المحاولة."
    }

    data class Validation(val fields: Map<String, List<String>>) : ApiFailure {
        override val message = "راجع البيانات المدخلة ثم حاول مرة أخرى."
    }

    data object RateLimited : ApiFailure {
        override val message = "طلبات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة."
    }

    data object Server : ApiFailure {
        override val message = "الخادم غير متاح مؤقتاً. أعد المحاولة لاحقاً."
    }

    data object MalformedResponse : ApiFailure {
        override val message = "وصلت استجابة غير متوقعة من الخادم."
    }

    data object Unknown : ApiFailure {
        override val message = "تعذر إكمال العملية. أعد المحاولة."
    }
}

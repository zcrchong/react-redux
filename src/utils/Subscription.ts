import { getBatch } from './batch'

// encapsulates the subscription logic for connecting a component to the redux store, as
// well as nesting subscriptions of descendant components, so that we can ensure the
// ancestor components re-render before descendants

type VoidFunc = () => void

type Listener = {
  callback: VoidFunc
  next: Listener | null
  prev: Listener | null
}

function createListenerCollection() {
  const batch = getBatch()
  let first: Listener | null = null
  let last: Listener | null = null

  return {
    clear() {
      first = null
      last = null
    },

    notify() {
      batch(() => {
        let listener = first
        while (listener) {
          listener.callback()
          listener = listener.next
        }
      })
    },

    get() {
      let listeners: Listener[] = []
      let listener = first
      while (listener) {
        listeners.push(listener)
        listener = listener.next
      }
      return listeners
    },

    subscribe(callback: () => void) {
      let isSubscribed = true

      let listener: Listener = (last = {
        callback,
        next: null,
        prev: last,
      })

      if (listener.prev) {
        listener.prev.next = listener
      } else {
        first = listener
      }

      return function unsubscribe() {
        if (!isSubscribed || first === null) return
        isSubscribed = false

        if (listener.next) {
          listener.next.prev = listener.prev
        } else {
          last = listener.prev
        }
        if (listener.prev) {
          listener.prev.next = listener.next
        } else {
          first = listener.next
        }
      }
    },
  }
}

type ListenerCollection = ReturnType<typeof createListenerCollection>

export interface Subscription {
  addNestedSub: (listener: VoidFunc) => VoidFunc
  notifyNestedSubs: VoidFunc
  handleChangeWrapper: VoidFunc
  isSubscribed: () => boolean
  onStateChange?: VoidFunc | null
  trySubscribe: VoidFunc
  tryUnsubscribe: VoidFunc
  getListeners: () => ListenerCollection
}

const nullListeners = ({
  notify() {},
  get: () => [],
} as unknown) as ListenerCollection

/* 发布订阅者模式 */
/**
 *
 * @param store
 * @param parentSub
 * @returns
 * 整个订阅器的核心，我浓缩提炼成8个字：层层订阅，上订下发。
 *
 * 层层订阅：
 * React-Redux 采用了层层订阅的思想，上述内容讲到 Provider 里面有一个 Subscription ，提前透露一下，每一个用 connect 包装的组件，内部也有一个 Subscription ，
 * 而且这些订阅器一层层建立起关联，Provider中的订阅器是最根部的订阅器，可以通过 trySubscribe 和 addNestedSub 方法可以看到。还有一个注意的点就是，
 * 如果父组件是一个 connect ，子孙组件也有 connect ，那么父子 connect 的 Subscription 也会建立起父子关系。
 *
 * 上订下发：
 * 在调用 trySubscribe 的时候，能够看到订阅器会和上一级的订阅器通过 addNestedSub 建立起关联，当 store 中 state 发生改变，会触发 store.subscribe
 *  Provider 中的根Subscription，根 Subscription 也不会直接派发更新，而是会下发给子代订阅器（ connect 中的 Subscription ），再由子代订阅器，决定是否更新组件，层层下发。
 *
 * ｜--------问与答--------｜
 * 问：为什么 React-Redux 会采用 subscription 订阅器进行订阅，而不是直接采用 store.subscribe 呢 ？
 * 1 首先 state 的改变，Provider 是不能直接下发更新的，如果下发更新，那么这个更新是整个应用层级上的，还有一点，如果需要 state 的组件，做一些性能优化的策略，那么该更新的组件不会被更新，不该更新的组件反而会更新了。
 * 2 父 Subscription -> 子 Subscription 这种模式，可以逐层管理 connect 的状态派发，不会因为 state 的改变而导致更新的混乱。
 * ｜--------END--------｜
 */

export function createSubscription(store: any, parentSub?: Subscription) {
  let unsubscribe: VoidFunc | undefined
  let listeners: ListenerCollection = nullListeners

  // Reasons to keep the subscription active
  let subscriptionsAmount = 0

  // Is this specific subscription subscribed (or only nested ones?)
  let selfSubscribed = false
  /* 负责检测是否该组件订阅，然后添加订阅者也就是listener */
  function addNestedSub(listener: () => void) {
    trySubscribe()

    const cleanupListener = listeners.subscribe(listener)

    // cleanup nested sub
    let removed = false
    return () => {
      if (!removed) {
        removed = true
        cleanupListener()
        tryUnsubscribe()
      }
    }
  }
  /* 向listeners发布通知 */
  function notifyNestedSubs() {
    listeners.notify()
  }

  function handleChangeWrapper() {
    if (subscription.onStateChange) {
      subscription.onStateChange()
    }
  }

  function isSubscribed() {
    return selfSubscribed
  }
  /* 开启订阅模式 首先判断当前订阅器有没有父级订阅器 ， 如果有父级订阅器(就是父级Subscription)，把自己的handleChangeWrapper放入到监听者链表中 */
  function trySubscribe() {
    subscriptionsAmount++
    if (!unsubscribe) {
      /*
      parentSub  即是provide value 里面的 Subscription 这里可以理解为 父级元素的 Subscription
      */
      unsubscribe = parentSub
        ? parentSub.addNestedSub(handleChangeWrapper)
        : store.subscribe(handleChangeWrapper)
      /* provider的Subscription是不存在parentSub，所以此时trySubscribe 就会调用 store.subscribe   */
      listeners = createListenerCollection()
    }
  }

  function tryUnsubscribe() {
    subscriptionsAmount--
    if (unsubscribe && subscriptionsAmount === 0) {
      unsubscribe()
      unsubscribe = undefined
      listeners.clear()
      listeners = nullListeners
    }
  }

  function trySubscribeSelf() {
    if (!selfSubscribed) {
      selfSubscribed = true
      trySubscribe()
    }
  }

  function tryUnsubscribeSelf() {
    if (selfSubscribed) {
      selfSubscribed = false
      tryUnsubscribe()
    }
  }

  const subscription: Subscription = {
    addNestedSub,
    notifyNestedSubs,
    handleChangeWrapper,
    isSubscribed,
    trySubscribe: trySubscribeSelf,
    tryUnsubscribe: tryUnsubscribeSelf,
    getListeners: () => listeners,
  }

  return subscription
}

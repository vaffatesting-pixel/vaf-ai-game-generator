// ─── Booking Agent ─────────────────────────────────────────────
// State machine for the complete booking flow.
// Built on the StateGraph engine for HITL-enabled transactional flow.
// Flow: DISCOVER → SEARCH → PRESENT → SELECT → CONFIRM → PAY → BOOK → NOTIFY

const { StateGraph, requireApproval } = require('../engine/stateGraph');
const { createTrace, TRACE_TYPES } = require('../engine/attribution');
const { recordBooking } = require('../engine/memory');
const { v4: uuidv4 } = require('uuid');

function createBookingGraph(pmsGateway) {
  const graph = new StateGraph({
    name: 'booking-flow',
    initialState: {
      stage: 'discover',
      searchResults: null,
      selectedRoom: null,
      totalPrice: 0,
      paymentRef: null,
      bookingId: null,
      errors: []
    }
  });

  // ─── NODE: DISCOVER ────────────────────────────────────────────
  // Guest expresses interest. Extract parameters.
  graph.addNode('discover', async (state) => {
    const { guestId, hotelId, personaId, channel } = state;

    createTrace({
      type: TRACE_TYPES.BOOKING_START,
      guestId, personaId, hotelId, channel,
      data: { checkIn: state.checkIn, checkOut: state.checkOut, guests: state.guests },
      parentTraceId: state.parentTraceId
    });

    return {
      stage: 'search',
      searchParams: {
        hotelId,
        checkIn: state.checkIn,
        checkOut: state.checkOut,
        adults: state.guests || 2,
        roomTypePreference: state.roomTypePreference || null
      }
    };
  });

  // ─── NODE: SEARCH ──────────────────────────────────────────────
  // Query PMS (via cache) for available rooms and pricing.
  graph.addNode('search', async (state) => {
    const { searchParams } = state;

    try {
      const availability = await pmsGateway.invoke('searchAvailability', searchParams);
      const pricing = await pmsGateway.invoke('getPricing', searchParams);
      const rooms = await pmsGateway.invoke('getRoomTypes', { hotelId: searchParams.hotelId });

      // Combine into presentable options
      const options = rooms.map(room => {
        const dates = Object.keys(pricing);
        let totalPrice = 0;
        let allAvailable = true;

        for (const date of dates) {
          const dateAvail = availability[date]?.[room.type || room.id];
          const datePrice = pricing[date]?.[room.type || room.id];

          if (!dateAvail || dateAvail.available <= 0) allAvailable = false;
          if (datePrice) totalPrice += datePrice.price || 0;
        }

        return {
          roomId: room.id || room.type,
          name: room.name || room.type,
          description: room.description || '',
          amenities: room.amenities || [],
          maxOccupancy: room.maxOccupancy || 2,
          totalPrice,
          currency: 'EUR',
          available: allAvailable,
          nights: dates.length
        };
      }).filter(opt => opt.available);

      if (options.length === 0) {
        return {
          stage: 'no_availability',
          searchResults: [],
          message: 'No rooms available for the selected dates.'
        };
      }

      return {
        stage: 'present',
        searchResults: options
      };
    } catch (err) {
      return {
        stage: 'error',
        errors: [...state.errors, `Search failed: ${err.message}`]
      };
    }
  });

  // ─── NODE: PRESENT ─────────────────────────────────────────────
  // Format options for Generative UI display.
  graph.addNode('present', async (state) => {
    const { searchResults, searchParams } = state;

    // Build a carousel-style data structure for the frontend
    const carousel = {
      type: 'room_carousel',
      hotelId: searchParams.hotelId,
      checkIn: searchParams.checkIn,
      checkOut: searchParams.checkOut,
      options: searchResults.map((room, i) => ({
        index: i,
        ...room,
        // Generative UI components
        ui: {
          card: {
            title: room.name,
            subtitle: `${room.nights} nights — €${room.totalPrice}`,
            description: room.description,
            amenityTags: room.amenities.slice(0, 5),
            cta: 'Select this room'
          }
        }
      }))
    };

    return {
      stage: 'awaiting_selection',
      generativeUI: carousel,
      message: `I found ${searchResults.length} room options for you. Here are the details:`
    };
  });

  // ─── NODE: SELECT ──────────────────────────────────────────────
  // Guest selects a room from the carousel.
  graph.addNode('select', async (state) => {
    const { selectedIndex, searchResults } = state;
    const selected = searchResults[selectedIndex || 0];

    if (!selected) {
      return { stage: 'error', errors: [...state.errors, 'Invalid room selection'] };
    }

    return {
      stage: 'confirm',
      selectedRoom: selected,
      totalPrice: selected.totalPrice,
      message: `You selected: ${selected.name} for €${selected.totalPrice} (${selected.nights} nights). Shall I proceed with the booking?`
    };
  });

  // ─── NODE: CONFIRM ─────────────────────────────────────────────
  // HITL checkpoint: guest confirms before payment.
  graph.addNode('confirm', async (state) => {
    if (!state.guestConfirmed) {
      return requireApproval(state, `Booking confirmation: ${state.selectedRoom.name} for €${state.totalPrice}`);
    }

    return { stage: 'pay' };
  });

  // ─── NODE: PAY ─────────────────────────────────────────────────
  // Process payment via Stripe (or demo mode).
  graph.addNode('pay', async (state) => {
    const { totalPrice, guestId, hotelId, personaId, channel } = state;

    try {
      // In production: create Stripe PaymentIntent
      // For now: demo payment
      const paymentRef = `PAY-${uuidv4().substring(0, 8).toUpperCase()}`;

      createTrace({
        type: TRACE_TYPES.PAYMENT,
        guestId, personaId, hotelId, channel,
        data: { amount: totalPrice, currency: 'EUR', paymentRef },
        parentTraceId: state.parentTraceId
      });

      return {
        stage: 'book',
        paymentRef,
        paymentStatus: 'completed'
      };
    } catch (err) {
      return {
        stage: 'payment_failed',
        errors: [...state.errors, `Payment failed: ${err.message}`]
      };
    }
  });

  // ─── NODE: BOOK ────────────────────────────────────────────────
  // Create the booking in PMS.
  graph.addNode('book', async (state) => {
    const { hotelId, guestId, personaId, channel, selectedRoom, searchParams, paymentRef, guestName } = state;

    try {
      const booking = await pmsGateway.invoke('createBooking', {
        hotelId,
        guestId,
        roomType: selectedRoom.roomId,
        checkIn: searchParams.checkIn,
        checkOut: searchParams.checkOut,
        guestName: guestName || 'Guest',
        paymentRef,
        _approved: true // HITL was done at confirm step
      });

      createTrace({
        type: TRACE_TYPES.BOOKING_CONFIRM,
        guestId, personaId, hotelId, channel,
        data: { bookingId: booking.bookingId, amount: state.totalPrice },
        parentTraceId: state.parentTraceId
      });

      // Save to guest memory
      recordBooking(guestId, {
        bookingId: booking.bookingId,
        hotelId,
        roomType: selectedRoom.roomId,
        roomName: selectedRoom.name,
        checkIn: searchParams.checkIn,
        checkOut: searchParams.checkOut,
        totalPrice: state.totalPrice,
        paymentRef
      });

      return {
        stage: 'notify',
        bookingId: booking.bookingId,
        bookingDetails: booking
      };
    } catch (err) {
      // COMPENSATING ACTION: if booking fails after payment, flag for refund
      return {
        stage: 'compensation_needed',
        errors: [...state.errors, `Booking creation failed after payment: ${err.message}`],
        refundRequired: true,
        paymentRef
      };
    }
  });

  // ─── NODE: NOTIFY ──────────────────────────────────────────────
  // Send confirmation to guest via appropriate channel.
  graph.addNode('notify', async (state) => {
    const { bookingId, selectedRoom, searchParams, totalPrice, guestName, channel } = state;

    const confirmation = {
      type: 'booking_confirmation',
      bookingId,
      guestName: guestName || 'Guest',
      hotel: searchParams.hotelId,
      room: selectedRoom.name,
      checkIn: searchParams.checkIn,
      checkOut: searchParams.checkOut,
      nights: selectedRoom.nights,
      totalPaid: `€${totalPrice}`,
      message: `Your booking is confirmed! Booking reference: ${bookingId}. We look forward to welcoming you on ${searchParams.checkIn}.`,
      // Generative UI for confirmation card
      ui: {
        card: {
          type: 'confirmation',
          icon: 'check-circle',
          title: 'Booking Confirmed',
          reference: bookingId,
          details: [
            { label: 'Room', value: selectedRoom.name },
            { label: 'Check-in', value: searchParams.checkIn },
            { label: 'Check-out', value: searchParams.checkOut },
            { label: 'Total', value: `€${totalPrice}` }
          ]
        }
      }
    };

    return {
      stage: 'completed',
      confirmation,
      message: confirmation.message
    };
  });

  // ─── NODE: ERROR / NO AVAILABILITY ─────────────────────────────
  graph.addNode('no_availability', async (state) => {
    return {
      stage: 'completed',
      message: 'Unfortunately there are no rooms available for your selected dates. Would you like to try different dates?',
      suggestAlternative: true
    };
  });

  graph.addNode('error', async (state) => {
    return {
      stage: 'completed',
      message: 'I encountered an issue while processing your request. Let me connect you with our team who can assist you directly.',
      escalate: true
    };
  });

  graph.addNode('compensation_needed', async (state) => {
    return {
      stage: 'completed',
      message: 'There was an issue finalizing your booking, but your payment is safe. Our team has been notified and will contact you within 5 minutes to confirm.',
      escalate: true,
      refundRequired: state.refundRequired
    };
  });

  graph.addNode('payment_failed', async (state) => {
    return {
      stage: 'completed',
      message: 'The payment could not be processed. Would you like to try again or use a different payment method?'
    };
  });

  // ─── EDGES ─────────────────────────────────────────────────────
  graph.setEntryPoint('discover');
  graph.addEdge('discover', 'search');

  graph.addConditionalEdge('search', (state) => {
    if (state.stage === 'no_availability') return 'no_availability';
    if (state.stage === 'error') return 'error';
    return 'present';
  });

  graph.addEdge('present', 'select');
  graph.addEdge('select', 'confirm');

  graph.addConditionalEdge('confirm', (state) => {
    if (state._requiresApproval) return null; // pause
    return 'pay';
  });

  graph.addConditionalEdge('pay', (state) => {
    if (state.stage === 'payment_failed') return 'payment_failed';
    return 'book';
  });

  graph.addConditionalEdge('book', (state) => {
    if (state.stage === 'compensation_needed') return 'compensation_needed';
    return 'notify';
  });

  // End nodes
  graph.setEndNode('notify');
  graph.setEndNode('no_availability');
  graph.setEndNode('error');
  graph.setEndNode('compensation_needed');
  graph.setEndNode('payment_failed');

  return graph;
}

module.exports = { createBookingGraph };
